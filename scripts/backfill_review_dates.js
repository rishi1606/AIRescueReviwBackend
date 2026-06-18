/**
 * One-time migration script to backfill review_date_parsed for existing reviews
 * that were scraped without it.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../models/Review');

const parseReviewDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    const clean = dateStr
      .trim()
      .replace(/^(reviewed|reviewed on|posted on|stayed in)\s*:?\s*/i, '')
      .replace(/\s+on\s+.*$/i, '')
      .trim()
      .toLowerCase();

    const now = new Date();
    if (clean === 'today' || clean === 'just now') return now;
    if (clean === 'yesterday') return new Date(now.getTime() - 86400000);

    const singleMatch = clean.match(/^(a|an)\s+(minute|hour|day|week|month)s?\s+ago$/);
    if (singleMatch) {
      const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
      return new Date(now.getTime() - (ms[singleMatch[2]] || 86400000));
    }

    const relMatch = clean.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/);
    if (relMatch) {
      const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
      return new Date(now.getTime() - parseInt(relMatch[1]) * (ms[relMatch[2]] || 86400000));
    }

    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) return parsed;
  } catch (e) { /* ignore */ }
  return null;
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const reviews = await Review.find({
      review_date_parsed: { $exists: false }
    }).select('review_id review_date');

    // Also find reviews where review_date_parsed is null
    const nullReviews = await Review.find({
      review_date_parsed: null,
      review_date: { $exists: true, $ne: null, $ne: '' }
    }).select('review_id review_date');

    const allReviews = [...reviews, ...nullReviews];
    // Deduplicate
    const seen = new Set();
    const unique = allReviews.filter(r => {
      if (seen.has(r.review_id)) return false;
      seen.add(r.review_id);
      return true;
    });

    console.log(`Found ${unique.length} reviews to backfill`);

    let updated = 0;
    let skipped = 0;

    for (const review of unique) {
      const parsed = parseReviewDate(review.review_date);
      if (parsed) {
        await Review.updateOne(
          { _id: review._id },
          { $set: { review_date_parsed: parsed } }
        );
        updated++;
      } else {
        skipped++;
      }
    }

    console.log(`Done! Updated: ${updated}, Skipped (unparseable): ${skipped}`);
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
})();
