const cron = require('node-cron');
const Review = require('../models/Review');
const Hotel = require('../models/Hotel');
const crypto = require('crypto');

// URLs provided/configured for the hotel
const BOOKING_URL = "https://www.booking.com/hotel/us/c-conference-center-indianapolis-indiana.html?aid=318615&label=New_Chain_Remarketing_English_EN_ROW_180652982544-kSJcMeBGS3XNlVAHmKBN4gS730275270871%3Apl%3Ata%3Ap1%3Ap2%3Aac%3Aap%3Aneg&sid=23837c5fa00ca5adfef397fd8aa73790&age=0&dest_id=20037880&dest_type=city&dist=0&group_adults=2&group_children=1&hapos=1&hpos=1&no_rooms=1&req_adults=2&req_age=0&req_children=1&room1=A%2CA%2C0&sb_price_type=total&sr_order=popularity&srepoch=1778921432&srpvid=4f243e2ab3380616&type=total&ucfs=1&#tab-main";
const GOOGLE_MAPS_URL = "https://www.google.com/travel/search?q=travelodge%20by%20wyndham%20united%20states&qs=CAAgACgAMiRDaGNJcy1QZnUtTzUxTjRyR2dzdlp5OHhkR1JvTkRSZk5oQUI4DUgA&ts=CAEaPAocEhoKCS9tLzA5Yzd3MDoNVW5pdGVkIFN0YXRlcxIcEhQKBwjqDxAFGBQSBwjqDxAFGBUYATIECAAQACoMCgo6A0lOUkIDEgEQ&ap=KigKEgmMuOkOCuDhvxFEaW_wLQNgwBISCaL1ojQ7mk1AEYnS3uC7W1DAMAC6AQdyZXZpZXdz";
const EXPEDIA_URL = "https://www.expedia.co.in/Indianapolis-Hotels-Ramada-By-Wyndham-Indianapolis-Speedway.h888691.Hotel-Information?expediaPropertyId=888691&chkin=2026-05-24&chkout=2026-05-25&rm1=a2&regionId=1598&destType=MARKET&sort=RECOMMENDED";
const AGODA_URL = "https://www.agoda.com/en-in/waterfront-hotel-and-conference-center-airport/hotel/indianapolis-in-us.html?countryId=181&finalPriceView=1&isShowMobileAppPrice=false&cid=1922885&numberOfBedrooms=&familyMode=false&adults=2&children=0&rooms=1&maxRooms=0&checkIn=2026-05-31&isCalendarCallout=false&childAges=&numberOfGuest=0&missingChildAges=false&travellerType=1&showReviewSubmissionEntry=false&currencyCode=INR&isFreeOccSearch=false&tag=6f147157-60b8-459f-af1a-9935d44970e9&flightSearchCriteria=%5Bobject+Object%5D&los=16&searchrequestid=052606c2-1e4e-48ea-8796-9fe0a0e89bc4&ds=gFkJ%2FbUlb9r5KgZw";

/**
 * Scrapes all 4 platforms and saves only reviews within the given rating range
 */
const scrapeAllPlatforms = async (tierName, minRating, maxRating) => {
  console.log(`[${tierName}] Scraping all platforms for ${minRating}-${maxRating} star reviews...`);

  await runBookingScrape(minRating, maxRating);
  await runGoogleScrape(minRating, maxRating);
  await runExpediaScrape(minRating, maxRating);
  await runAgodaScrape(minRating, maxRating);

  console.log(`[${tierName}] Scraping cycle complete.`);
};

/**
 * Initializes the cron jobs for automatic review acquisition and AI processing
 */
const initCronJobs = () => {
  // ═══════════════════════════════════════════
  // AI Worker: Processes "Pending AI" reviews every minute
  // ═══════════════════════════════════════════
  cron.schedule('* * * * *', async () => {
    console.log('[AI Worker] Checking for pending reviews...');
    await runAIWorker();
  });

  // ═══════════════════════════════════════════
  // CRON 1 — HIGH URGENCY (1-2 star reviews)
  // Schedule: Every 30 minutes
  // Reason : Angry guest. Every minute matters.
  // ═══════════════════════════════════════════
  cron.schedule('*/30 * * * *', async () => {
    await scrapeAllPlatforms('HIGH URGENCY', 1, 2);
  });

  // ═══════════════════════════════════════════
  // CRON 2 — MEDIUM URGENCY (3 star reviews)
  // Schedule: Every 4 hours
  // Reason : Neutral reviews need response but not instant.
  // ═══════════════════════════════════════════
  cron.schedule('0 */4 * * *', async () => {
    await scrapeAllPlatforms('MEDIUM URGENCY', 3, 3);
  });

  // ═══════════════════════════════════════════
  // CRON 3 — LOW URGENCY (4-5 star reviews)
  // Schedule: Every 8 hours
  // Reason : Positive reviews. GM can reply during business hours.
  // ═══════════════════════════════════════════
  cron.schedule('0 */8 * * *', async () => {
    await scrapeAllPlatforms('LOW URGENCY', 4, 5);
  });

  console.log('[Cron] Tiered scraper crons registered:');
  console.log('  HIGH   (1-2★) → Every 30 minutes');
  console.log('  MEDIUM (3★)   → Every 4 hours');
  console.log('  LOW    (4-5★) → Every 8 hours');
};

/**
 * Common logic to save unique reviews to DB
 * @param {Object} hotel - Hotel document
 * @param {Array} reviews - Raw scraped reviews
 * @param {String} platform - Platform name
 * @param {Number} minRating - Min star rating to save (1-5 scale)
 * @param {Number} maxRating - Max star rating to save (1-5 scale)
 */
const saveUniqueReviews = async (hotel, reviews, platform, minRating = 1, maxRating = 5) => {
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

    // Normalise rating: Booking/Agoda use 1-10 scale → convert to 1-5
    let rating = raw.rating;
    if (rating > 5) {
      rating = Math.round((rating / 2) * 10) / 10;
    }

    // Filter by rating range for this urgency tier
    if (rating < minRating || rating > maxRating) {
      skippedByRating++;
      continue;
    }

    const exists = await Review.findOne({ review_id });
    if (!exists) {
      await Review.create({
        review_id,
        hotel_id: hotel._id,
        hotel_name: hotel.hotel_name,
        reviewer_name: raw.reviewerName,
        rating: rating,
        review_text: raw.reviewText,
        review_date: raw.reviewDate,
        platform: platform,
        status: "Pending AI",
        imported_at: Date.now()
      });
      newCount++;
    } else {
      duplicateCount++;
    }
  }
  return { newCount, duplicateCount, skippedByRating };
};

/**
 * Agoda Scrape Task
 */
const runAgodaScrape = async (minRating = 1, maxRating = 5) => {
  const { openAgodaReviews } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Agoda sync.');
    const result = await openAgodaReviews(AGODA_URL, 20, false);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Agoda", minRating, maxRating);
      console.log(`[Cron] Agoda Sync (${minRating}-${maxRating}★): New: ${stats.newCount}, Dupes: ${stats.duplicateCount}, Filtered: ${stats.skippedByRating}`);
    }
  } catch (err) {
    console.error('[Cron] Agoda Sync Error:', err);
  }
};

/**
 * Expedia Scrape Task
 */
const runExpediaScrape = async (minRating = 1, maxRating = 5) => {
  const { openExpediaReviews } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Expedia sync.');
    const result = await openExpediaReviews(EXPEDIA_URL, 20, false);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Expedia", minRating, maxRating);
      console.log(`[Cron] Expedia Sync (${minRating}-${maxRating}★): New: ${stats.newCount}, Dupes: ${stats.duplicateCount}, Filtered: ${stats.skippedByRating}`);
    }
  } catch (err) {
    console.error('[Cron] Expedia Sync Error:', err);
  }
};

/**
 * Booking.com Scrape Task
 */
const runBookingScrape = async (minRating = 1, maxRating = 5) => {
  const { openBookingReviews } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Booking sync.');
    const result = await openBookingReviews(BOOKING_URL, 20, true);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Booking.com", minRating, maxRating);
      console.log(`[Cron] Booking.com Sync (${minRating}-${maxRating}★): New: ${stats.newCount}, Dupes: ${stats.duplicateCount}, Filtered: ${stats.skippedByRating}`);
    }
  } catch (err) {
    console.error('[Cron] Booking Sync Error:', err);
  }
};

/**
 * Google Maps Scrape Task
 */
const runGoogleScrape = async (minRating = 1, maxRating = 5) => {
  const { openGoogleMaps } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Google sync.');
    const result = await openGoogleMaps(GOOGLE_MAPS_URL, 15, true);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Google", minRating, maxRating);
      console.log(`[Cron] Google Sync (${minRating}-${maxRating}★): New: ${stats.newCount}, Dupes: ${stats.duplicateCount}, Filtered: ${stats.skippedByRating}`);
    }
  } catch (err) {
    console.error('[Cron] Google Sync Error:', err);
  }
};

/**
 * AI Worker Task: Batch-processes reviews marked as "Pending AI"
 * BATCH SIZE: 5 reviews per API call (hard rule)
 * DELAY: 2000ms between batches (Groq rate limit: 30 req/min)
 */
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;

const runAIWorker = async () => {
  const { analyseBatch } = require('./groqService');

  try {
    // Fetch ALL pending reviews
    const pendingReviews = await Review.find({ status: "Pending AI" });

    if (pendingReviews.length === 0) {
      return;
    }

    console.log(`[AI Worker] Found ${pendingReviews.length} pending reviews. Processing in batches of ${BATCH_SIZE}...`);

    // Split into chunks of 5
    const batches = [];
    for (let i = 0; i < pendingReviews.length; i += BATCH_SIZE) {
      batches.push(pendingReviews.slice(i, i + BATCH_SIZE));
    }

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(`[AI Worker] Batch ${b + 1}/${batches.length} (${batch.length} reviews)...`);

      const results = await analyseBatch(batch);

      if (results.length > 0) {
        // Match each result back to review by index
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
          review.status = "Classified";
          review.classified_at = Date.now();

          await review.save();
        }
        console.log(`[AI Worker] Batch ${b + 1} done. ${results.length} classified.`);
      } else {
        // Batch failed — mark all for retry
        console.warn(`[AI Worker] Batch ${b + 1} failed. Marking for retry.`);
        for (const review of batch) {
          review.status = "AI Failed";
          await review.save();
        }
      }

      // 2s delay between batches (rate limit safety)
      if (b < batches.length - 1) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
  } catch (err) {
    console.error('[AI Worker] Error:', err);
  }
};

module.exports = {
  initCronJobs,
  runBookingScrape,
  runGoogleScrape,
  runExpediaScrape,
  runAgodaScrape,
  runAIWorker
};
