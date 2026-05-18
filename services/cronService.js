const cron = require('node-cron');
const Review = require('../models/Review');
const Hotel = require('../models/Hotel');
const crypto = require('crypto');
const { openAgodaReviews, openExpediaReviews, openBookingReviews, openGoogleMaps, openAirbnbReviews, openHotelsReviews } = require('./scraperService');
const { analyseBatch } = require('./groqService');

let activeCrons = [];

const getCronPattern = (interval, staggerMins) => {
  if (interval === '30min') {
    const startMin = staggerMins % 30;
    return `${startMin},${startMin + 30} * * * *`;
  }

  if (interval === '1hr') {
    return `${staggerMins % 60} * * * *`;
  }

  const hoursMatch = interval.match(/^(\d+)hr$/);
  if (hoursMatch) {
    const hoursVal = parseInt(hoursMatch[1]);
    const startMin = staggerMins % 60;
    let hourPattern = `*/${hoursVal}`;
    if (staggerMins >= 60) {
      const hourOffset = Math.floor(staggerMins / 60) % hoursVal;
      hourPattern = `${hourOffset}-23/${hoursVal}`;
    }
    return `${startMin} ${hourPattern} * * *`;
  }

  return `0 */6 * * *`;
};

const clearCrons = () => {
  activeCrons.forEach(task => task.stop());
  activeCrons = [];
};

const initCronJobs = async () => {
  clearCrons();
  console.log('[Cron] Initialising dynamic property crons...');

  // AI Worker: Processes exactly 1 batch of up to 5 reviews per minute
  const aiWorkerTask = cron.schedule('* * * * *', async () => {
    await runAIWorker();
  });
  activeCrons.push(aiWorkerTask);

  // Reload properties from DB every 24hrs
  const reloadTask = cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] 24hr automatic reload of properties...');
    await initCronJobs();
  });
  activeCrons.push(reloadTask);

  const hotel = await Hotel.findOne();
  if (!hotel || !hotel.properties || hotel.properties.length === 0) {
    console.log('[Cron] No properties found. Cron inactive.');
    return;
  }

  const activeProps = hotel.properties.filter(p => p.is_active);
  console.log(`[Cron] Found ${activeProps.length} active properties.`);

  activeProps.forEach((prop, stagger_index) => {
    // URGENT urgency (1-3★): dynamic per-property interval, 15 min gap
    const urgentPattern = getCronPattern(prop.urgent_sync_interval || '1hr', stagger_index * 15);
    console.log(`[Cron][${prop.name}] Scheduling URGENT cycle with interval ${prop.urgent_sync_interval || '1hr'} -> Pattern: ${urgentPattern}`);
    const urgentTask = cron.schedule(urgentPattern, async () => {
      await processPropertyTier(hotel._id, prop, 'URGENT', 1, 3);
    });
    activeCrons.push(urgentTask);

    // LOW urgency (4-5★): dynamic per-property interval, 20 min gap
    const lowPattern = getCronPattern(prop.low_sync_interval || '6hr', stagger_index * 20);
    console.log(`[Cron][${prop.name}] Scheduling LOW cycle with interval ${prop.low_sync_interval || '6hr'} -> Pattern: ${lowPattern}`);
    const lowTask = cron.schedule(lowPattern, async () => {
      await processPropertyTier(hotel._id, prop, 'LOW', 4, 5);
    });
    activeCrons.push(lowTask);
  });
};

const updatePropertySyncStatus = async (hotel_id, prop_id, status) => {
  try {
    await Hotel.updateOne(
      { _id: hotel_id, "properties._id": prop_id },
      {
        $set: {
          "properties.$.last_sync_status": status,
          "properties.$.last_sync_time": new Date()
        }
      }
    );
  } catch (err) {
    console.error('[Cron] Failed to update property sync status:', err);
  }
};

const processPropertyTier = async (hotel_id, prop, tierName, minRating, maxRating) => {
  try {
    console.log(`[Cron][${prop.name}] Starting ${tierName} urgency cycle (${minRating}-${maxRating}★)...`);

    await scrapePropertyPlatforms(hotel_id, prop, minRating, maxRating);

    await updatePropertySyncStatus(hotel_id, prop._id, 'success');

    // First analysis runs directly after saving new reviews
    await runAIWorker();

  } catch (err) {
    console.error(`[Cron][${prop.name}] Critical Error in ${tierName} cycle:`, err);
    await updatePropertySyncStatus(hotel_id, prop._id, 'failed');
  }
};

const scrapePropertyPlatforms = async (hotel_id, prop, minRating, maxRating) => {
  const platforms = prop.platforms || {};
  let totalNew = 0;

  const scrapers = {
    'Booking.com': openBookingReviews,
    'Google': openGoogleMaps,
    'Expedia': openExpediaReviews,
    'Agoda': openAgodaReviews,
    'Airbnb': openAirbnbReviews,
    'Hotels.com': openHotelsReviews,
    'TripAdvisor': null // Not implemented yet
  };

  for (const [platform, url] of Object.entries(platforms)) {
    if (!url) continue;

    const scraperFn = scrapers[platform];
    if (!scraperFn) continue;

    try {
      const isHeadless = platform === 'Google' || platform === 'Booking.com';
      const result = await scraperFn(url, 2, isHeadless);

      if (result && result.success && result.reviews) {
        if (result.reviews.length === 0) {
          console.log(`[Cron][${prop.name}] No new reviews for ${prop.name} on ${platform}`);
          continue;
        }
        const stats = await saveUniqueReviews(hotel_id, prop.name, result.reviews, platform, minRating, maxRating);
        totalNew += stats.newCount;
        console.log(`[Cron][${prop.name}] [${platform}] — ${stats.newCount} fetched, ${stats.duplicateCount} dupes, ${stats.skippedByRating} filtered`);
      } else if (result && !result.success) {
        console.error(`[Cron][${prop.name}] [${platform}] Scrape failed:`, result.message);
      }
    } catch (err) {
      console.error(`[Cron][${prop.name}] [${platform}] Error:`, err.message);
    }
  }
  return totalNew;
};

const saveUniqueReviews = async (hotel_id, hotel_name, reviews, platform, minRating, maxRating) => {
  let newCount = 0;
  let duplicateCount = 0;
  let skippedByRating = 0;

  for (const raw of reviews) {
    if (!raw.reviewText || raw.reviewText.trim() === "") {
      duplicateCount++;
      continue;
    }

    const uniqueString = `${platform}_${raw.reviewerName}_${raw.reviewText}`;
    const review_id = crypto.createHash('md5').update(uniqueString).digest('hex');

    let rating = raw.rating;
    if (platform === 'Booking.com' || platform === 'Agoda') {
      rating = Math.round((rating / 2) * 10) / 10;
    } else {
      rating = Math.round(rating * 10) / 10;
    }

    if (rating < minRating || rating > maxRating) {
      skippedByRating++;
      continue;
    }

    const exists = await Review.findOne({ review_id });
    if (!exists) {
      await Review.create({
        review_id,
        hotel_id: hotel_id,
        hotel_name: hotel_name,
        reviewer_name: raw.reviewerName,
        rating: rating,
        review_text: raw.reviewText,
        review_date: raw.reviewDate,
        platform: platform,
        status: "Pending AI",
        is_processed: false,
        retry_count: 0,
        imported_at: Date.now()
      });
      newCount++;
    } else {
      duplicateCount++;
    }
  }
  return { newCount, duplicateCount, skippedByRating };
};

const runAIWorker = async () => {
  try {
    const batch = await Review.find({
      is_processed: false,
      retry_count: { $lt: 3 }
    }).limit(5); // Exactly 1 batch of 5

    if (batch.length === 0) return;

    console.log(`[AI Worker] Processing 1 batch of ${batch.length} reviews...`);

    let processedCount = 0;
    let failedCount = 0;

    const hotel = await Hotel.findOne();
    const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);

    try {
      const results = await analyseBatch(batch);

      if (results && results.length > 0) {
        for (const result of results) {
          const review = batch[result.index];
          if (!review) continue;

          review.sentiment = result.sentiment;
          review.primary_department = result.primary_department;
          review.urgency = result.urgency;
          review.issues = result.issues || [];
          review.positive_aspects = result.positive_aspects || [];
          review.confidence = result.confidence;
          review.needs_human_review = result.needs_human_review;

          review.is_processed = true;
          review.classified_at = Date.now();

          // Apply Escalate / Suspicious tags automatically based on rating and settings
          review.escalation = review.rating <= escalationThreshold;

          if (review.rating <= 1) {
            review.is_suspicious = true;
            review.suspicious_reason = "Auto-flagged: Rating is 1 star or below.";
            review.status = "Suspicious";
          } else if (review.rating <= escalationThreshold) {
            review.status = "ESCALATED";
          } else {
            review.status = "Classified";
          }

          await review.save();
          processedCount++;
        }
        console.log(`[AI Worker] Success: ${processedCount} reviews classified.`);
      } else {
        throw new Error("No results from AI provider.");
      }
    } catch (err) {
      console.warn(`[AI Worker] Batch failed. Incrementing retries. Error: ${err.message}`);
      for (const review of batch) {
        review.retry_count += 1;
        if (review.retry_count >= 3) {
          review.needs_human_review = true;
          review.status = "AI Failed";
          review.is_processed = true;
        }
        await review.save();
        failedCount++;
      }
    }

  } catch (err) {
    console.error(`[AI Worker] Critical Error:`, err);
  }
};

module.exports = {
  initCronJobs,
  processPropertyTier,
  runAIWorker
};
