const cron = require('node-cron');
const Review = require('../models/Review');
const Hotel = require('../models/Hotel');
const { openBookingReviews, openGoogleMaps } = require('./scraperService');
const crypto = require('crypto');

// URLs provided/configured for the hotel
const BOOKING_URL = "https://www.booking.com/hotel/us/c-conference-center-indianapolis-indiana.html?aid=318615&label=New_Chain_Remarketing_English_EN_ROW_180652982544-kSJcMeBGS3XNlVAHmKBN4gS730275270871%3Apl%3Ata%3Ap1%3Ap2%3Aac%3Aap%3Aneg&sid=23837c5fa00ca5adfef397fd8aa73790&age=0&dest_id=20037880&dest_type=city&dist=0&group_adults=2&group_children=1&hapos=1&hpos=1&no_rooms=1&req_adults=2&req_age=0&req_children=1&room1=A%2CA%2C0&sb_price_type=total&sr_order=popularity&srepoch=1778921432&srpvid=4f243e2ab3380616&type=total&ucfs=1&#tab-main";
const GOOGLE_MAPS_URL = "https://www.google.com/travel/search?q=travelodge%20by%20wyndham%20united%20states&qs=CAAgACgAMiRDaGNJcy1QZnUtTzUxTjRyR2dzdlp5OHhkR1JvTkRSZk5oQUI4DUgA&ts=CAEaPAocEhoKCS9tLzA5Yzd3MDoNVW5pdGVkIFN0YXRlcxIcEhQKBwjqDxAFGBQSBwjqDxAFGBUYATIECAAQACoMCgo6A0lOUkIDEgEQ&ap=KigKEgmMuOkOCuDhvxFEaW_wLQNgwBISCaL1ojQ7mk1AEYnS3uC7W1DAMAC6AQdyZXZpZXdz"; // Placeholder IHG Indianapolis Google Maps URL

/**
 * Initializes the cron jobs for automatic review acquisition
 */
const initCronJobs = () => {
  // Schedule: Booking.com at 8:00 AM IST daily (02:30 UTC)
  cron.schedule('24 15 * * *', async () => {
    console.log('[Cron] Triggering daily Booking.com review sync...');
    await runBookingScrape();
  });

  // Schedule: Google Maps at 8:15 AM IST daily (02:45 UTC)
  cron.schedule('29 15 * * *', async () => {
    console.log('[Cron] Triggering daily Google Maps review sync...');
    await runGoogleScrape();
  });

  console.log('[Cron] Daily Booking (08:00 AM) and Google (08:15 AM) scrapers scheduled (IST).');
};

/**
 * Common logic to save unique reviews to DB
 */
const saveUniqueReviews = async (hotel, reviews, platform) => {
  let newCount = 0;
  let duplicateCount = 0;

  for (const raw of reviews) {
    // SKIP reviews with no text to prevent Mongoose validation errors
    if (!raw.reviewText || raw.reviewText.trim() === "") {
      duplicateCount++; // Treat as skipped
      continue;
    }

    const uniqueString = `${platform}_${raw.reviewerName}_${raw.reviewText}`;
    const review_id = crypto.createHash('md5').update(uniqueString).digest('hex');

    // Normalize rating (e.g., Booking.com 10-point scale -> 5-star scale)
    let rating = raw.rating;
    if (rating > 5) {
      rating = Math.round((rating / 2) * 10) / 10; // e.g., 8.4 -> 4.2
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
 * Booking.com Scrape Task
 */
const runBookingScrape = async () => {
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Booking sync.');

    const result = await openBookingReviews(BOOKING_URL, 30);
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
  try {
    const hotel = await Hotel.findOne();
    if (!hotel) return console.error('[Cron] No hotel found for Google sync.');

    const result = await openGoogleMaps(GOOGLE_MAPS_URL, 30);
    if (result.success && result.reviews) {
      const stats = await saveUniqueReviews(hotel, result.reviews, "Google");
      console.log(`[Cron] Google Maps Sync: New: ${stats.newCount}, Skipped: ${stats.duplicateCount}`);
    }
  } catch (err) {
    console.error('[Cron] Google Sync Error:', err);
  }
};

module.exports = {
  initCronJobs,
  runBookingScrape,
  runGoogleScrape
};
