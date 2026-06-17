const cron = require('node-cron');
const Review = require('../models/Review');
const Hotel = require('../models/Hotel');
const crypto = require('crypto');
const { openAgodaReviews, openExpediaReviews, openBookingReviews, openGoogleMaps, openAirbnbReviews, openHotelsReviews } = require('./scraperService');
const { analyseBatch } = require('./groqService');

let activeCrons = [];

const getCronPattern = (interval, staggerMins) => {
  const minMatch = interval.match(/^(\d+)min$/);
  if (minMatch) {
    const minVal = parseInt(minMatch[1]);
    const startMin = staggerMins % minVal;
    return `${startMin}-59/${minVal} * * * *`;
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
    // Unified review sync (1-5★): dynamic per-property interval, 15 min gap
    const syncPattern = getCronPattern(prop.urgent_sync_interval || '5hr', stagger_index * 15);
    console.log(`[Cron][${prop.name}] Scheduling unified sync cycle with interval ${prop.urgent_sync_interval || '5hr'} -> Pattern: ${syncPattern} (IST)`);
    const syncTask = cron.schedule(syncPattern, async () => {
      await processPropertyTier(hotel._id, prop, 'ALL', 1, 5);
    }, { timezone: "Asia/Kolkata" });
    activeCrons.push(syncTask);
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
    'Agoda': openAgodaReviews,
    'Airbnb': openAirbnbReviews,
  };

  for (const [platform, url] of Object.entries(platforms)) {
    if (!url) continue;

    const scraperFn = scrapers[platform];
    if (!scraperFn) continue;

    try {
      const limit = prop.max_reviews_per_sync || 5;
      const isHeadless = platform === 'Google' || platform === 'Booking.com';

      console.log(`[Cron][${prop.name}][${platform}] Scraping last 3 months (limit: ${limit})`);

      // Load existing reviews so we can deduplicate them
      const existingDocs = await Review.find({ hotel_id, platform }).select('reviewer_name review_text');
      const existingKeys = existingDocs.map(r => (r.reviewer_name || "") + (r.review_text || ""));

      const result = await scraperFn(url, limit, isHeadless, existingKeys, minRating, maxRating);

      if (result && result.success && result.reviews) {
        if (result.reviews.length === 0) {
          console.log(`[Cron][${prop.name}][${platform}] Scrape returned 0 reviews within 3 months.`);
        } else {
          const stats = await saveUniqueReviews(hotel_id, prop.name, result.reviews, platform, minRating, maxRating);
          totalNew += stats.newCount;
          console.log(`[Cron][${prop.name}][${platform}] Sync — ${stats.newCount} fetched, ${stats.duplicateCount} dupes, ${stats.skippedByRating} filtered`);
        }
      } else if (result && !result.success) {
        console.error(`[Cron][${prop.name}][${platform}] Scrape failed:`, result.message);
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

    const normText = raw.reviewText.trim().replace(/\s+/g, ' ').toLowerCase().substring(0, 100);
    const uniqueString = `${platform}_${raw.reviewerName?.trim().toLowerCase()}_${normText}`;
    const review_id = crypto.createHash('md5').update(uniqueString).digest('hex');

    const rawRating = raw.rating;
    const rawScale = (platform === 'Booking.com' || platform === 'Agoda') ? 10 : 5;
    const normalisedRating = (platform === 'Booking.com' || platform === 'Agoda')
      ? (Math.round((rawRating / 2) * 10) / 10)
      : (Math.round(rawRating * 10) / 10);

    const rating = normalisedRating;

    let finalMin = minRating;
    let finalMax = maxRating;

    if (minRating === 1 && maxRating === 3) {
      if (platform === 'Booking.com' || platform === 'Agoda') {
        finalMin = 0;
        finalMax = 3.9;
      }
    }

    if (rating < finalMin || rating > finalMax) {
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
        raw_rating: rawRating,
        raw_rating_scale: rawScale,
        normalised_rating: normalisedRating,
        review_text: raw.reviewText,
        review_date: raw.reviewDate,
        platform: platform,
        photo_urls: raw.photoUrls || [],
        country: raw.country || '',
        room_type: raw.roomType || '',
        stay_duration: raw.stayDuration || '',
        stay_date: raw.stayDate || '',
        traveler_type: raw.travelerType || '',
        status: "Pending",
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
          review.sentiment_reason = result.sentiment_reason || null;
          review.primary_department = result.primary_department;
          review.urgency = result.urgency;
          review.urgency_reason = result.urgency_reason || null;
          review.guest_emotion = result.guest_emotion || null;
          review.issues = result.issues || [];
          review.positive_aspects = result.positive_aspects || [];
          review.confidence = result.confidence;
          review.needs_human_review = result.needs_human_review;
          review.staff_mentions = result.staff_mentions || [];
          review.escalation_risk = result.escalation_risk || false;
          review.ai_error = null;

          review.is_processed = true;
          review.classified_at = Date.now();

          // Apply Escalate / Suspicious tags automatically based on rating and settings
          review.escalation = review.rating <= escalationThreshold;
          const displayRating = review.raw_rating != null ? `${review.raw_rating}/${review.raw_rating_scale}` : `${review.rating}/5`;
          const normalizedDisplay = review.raw_rating != null ? ` (normalized: ${review.rating}/5)` : '';
          review.escalation_reason = review.rating <= escalationThreshold
            ? `Rating ${displayRating}${normalizedDisplay} is at or below escalation threshold (${escalationThreshold}/5)`
            : null;

          // Only AI-detected suspicious should mark as Suspicious (fake/spam/contradiction)
          // Safeguard: 4-5★ reviews with Positive/Neutral sentiment are NEVER suspicious
          // (the small AI model sometimes falsely flags short positive reviews)
          const aiSaysSuspicious = result.is_suspicious && !(
            review.rating >= 4 && ['Positive', 'Neutral'].includes(result.sentiment)
          );

          if (aiSaysSuspicious) {
            review.is_suspicious = true;
            review.suspicious_reason = "Flagged: review text contradicts the star rating or appears suspicious.";
            review.status = "Suspicious";
          } else if (review.rating <= escalationThreshold) {
            review.status = "ESCALATED";
          } else {
            review.status = "Classified";
          }

          // Keyword Alert auto-flagging
          const keywordAlerts = hotel?.keywordAlerts || [];
          if (keywordAlerts.length > 0) {
            const reviewText = (review.review_text || "").toLowerCase();
            const matchedKeywords = keywordAlerts.filter(kw => reviewText.includes(kw.toLowerCase()));
            if (matchedKeywords.length > 0) {
              review.keyword_flagged = true;
              review.matched_keywords = matchedKeywords;
              if (!review.is_suspicious) {
                review.is_suspicious = true;
                review.suspicious_reason = `Keyword alert: review contains flagged keyword(s): ${matchedKeywords.join(", ")}`;
              }
              if (review.status === "Classified") {
                review.status = "ESCALATED";
                review.escalation = true;
                review.escalation_reason = (review.escalation_reason ? review.escalation_reason + " | " : "") + `Keyword alert: "${matchedKeywords.join('", "')}"`;
              }
            }
          }

          // Determine human review reason based on confidence
          const confidenceThreshold = parseInt(hotel?.aiConfig?.confidenceThreshold || 75);
          const belowThreshold = result.confidence != null && result.confidence < confidenceThreshold;
          if (belowThreshold) {
            review.needs_human_review = true;
            review.human_review_reason = `Analysis confidence (${result.confidence}%) is below the trust threshold (${confidenceThreshold}%)`;
          } else {
            review.needs_human_review = false;
            review.human_review_reason = null;
          }
          // Push audit log entry
          if (!review.audit_log) review.audit_log = [];
          review.audit_log.push({
            action: "classified",
            actor: "System",
            details: `Classified as ${result.sentiment} (${result.confidence}% confidence) — ${review.primary_department}, ${review.urgency} urgency`,
            timestamp: Date.now()
          });

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
          review.human_review_reason = `Analysis failed after 3 attempts: ${err.message}`;
          review.ai_error = err.message || "Unknown processing error";
          review.status = "Failed";
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
