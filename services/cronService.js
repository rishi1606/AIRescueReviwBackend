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
 * Initializes the cron jobs for automatic review acquisition and AI processing
 */
const initCronJobs = () => {
  // 1. AI Worker: Processes pending reviews every minute
  cron.schedule('* * * * *', async () => {
    console.log('[AI Worker] Checking for pending reviews...');
    await runAIWorker();
  });

  // 2. Schedule: Agoda at 3:52 PM IST daily (Testing)
  cron.schedule('15 16 * * *', async () => {
    console.log('[Cron] Triggering daily Agoda review sync...');
    await runAgodaScrape();
  });

  // Schedule: Expedia at 3:47 PM IST daily
  cron.schedule('47 15 * * *', async () => {
    console.log('[Cron] Triggering daily Expedia review sync...');
    await runExpediaScrape();
  });

  // Schedule: Booking.com at 3:17 PM IST daily
  cron.schedule('17 15 * * *', async () => {
    console.log('[Cron] Triggering daily Booking.com review sync...');
    await runBookingScrape();
  });

  // Schedule: Google Maps at 3:18 PM IST daily
  cron.schedule('18 15 * * *', async () => {
    console.log('[Cron] Triggering daily Google Maps review sync...');
    await runGoogleScrape();
  });

  console.log('[Cron] All scrapers scheduled (Booking, Google, Expedia, Agoda).');
};

/**
 * Common logic to save unique reviews to DB
 */
const saveUniqueReviews = async (hotel, reviews, platform) => {
  let newCount = 0;
  let duplicateCount = 0;

  for (const raw of reviews) {
    if (!raw.reviewText || raw.reviewText.trim() === "") {
      duplicateCount++;
      continue;
    }

    const uniqueString = `${platform}_${raw.reviewerName}_${raw.reviewText}`;
    const review_id = crypto.createHash('md5').update(uniqueString).digest('hex');

    let rating = raw.rating;
    if (rating > 5) {
      rating = Math.round((rating / 2) * 10) / 10;
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
  return { newCount, duplicateCount };
};

/**
 * Agoda Scrape Task
 */
const runAgodaScrape = async () => {
  const { openAgodaReviews } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Agoda sync.');
    const result = await openAgodaReviews(AGODA_URL, 20, false);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Agoda");
      console.log(`[Cron] Agoda Sync: New: ${stats.newCount}, Skipped: ${stats.duplicateCount}`);
    }
  } catch (err) {
    console.error('[Cron] Agoda Sync Error:', err);
  }
};

/**
 * Expedia Scrape Task
 */
const runExpediaScrape = async () => {
  const { openExpediaReviews } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Expedia sync.');
    const result = await openExpediaReviews(EXPEDIA_URL, 20, false);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Expedia");
      console.log(`[Cron] Expedia Sync: New: ${stats.newCount}, Skipped: ${stats.duplicateCount}`);
    }
  } catch (err) {
    console.error('[Cron] Expedia Sync Error:', err);
  }
};

/**
 * Booking.com Scrape Task
 */
const runBookingScrape = async () => {
  const { openBookingReviews } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Booking sync.');
    const result = await openBookingReviews(BOOKING_URL, 20, true);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Booking.com");
      console.log(`[Cron] Booking.com Sync: New: ${stats.newCount}, Skipped: ${stats.duplicateCount}`);
    }
  } catch (err) {
    console.error('[Cron] Booking Sync Error:', err);
  }
};

/**
 * Google Maps Scrape Task
 */
const runGoogleScrape = async () => {
  const { openGoogleMaps } = require('./scraperService');
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Google sync.');
    const result = await openGoogleMaps(GOOGLE_MAPS_URL, 15, true);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Google");
      console.log(`[Cron] Google Maps Sync: New: ${stats.newCount}, Skipped: ${stats.duplicateCount}`);
    }
  } catch (err) {
    console.error('[Cron] Google Sync Error:', err);
  }
};

/**
 * AI Worker Task: Processes a batch of reviews marked as "Pending AI"
 */
const runAIWorker = async () => {
  const { analyseReview } = require('./groqService');

  try {
    // 1. Fetch 3-5 pending reviews
    const pendingReviews = await Review.find({ status: "Pending AI" }).limit(5);

    if (pendingReviews.length === 0) {
      console.log('[AI Worker] No pending reviews to process.');
      return;
    }

    console.log(`[AI Worker] Processing batch of ${pendingReviews.length} reviews...`);

    for (const review of pendingReviews) {
      console.log(`[AI Worker] Analyzing review ${review.review_id} from ${review.platform}...`);

      const aiResult = await analyseReview(review.review_text, review.rating);

      if (aiResult) {
        // Update review with AI insights
        review.sentiment = aiResult.sentiment;
        review.primary_department = aiResult.primary_department;
        review.urgency = aiResult.urgency;
        review.issues = aiResult.issues || [];
        review.positive_aspects = aiResult.positive_aspects || [];
        review.suggested_reply = aiResult.suggested_reply;
        review.confidence = aiResult.confidence;
        review.needs_human_review = aiResult.needs_human_review;

        // Finalize status
        review.status = "Classified";
        review.classified_at = Date.now();

        await review.save();
        console.log(`[AI Worker] Successfully classified review ${review.review_id}`);
      } else {
        console.warn(`[AI Worker] AI Analysis failed for ${review.review_id}`);
        // Optionally mark as failed or retry later
        review.status = "AI Failed";
        await review.save();
      }
    }
  } catch (err) {
    console.error('[AI Worker] Error during processing:', err);
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
