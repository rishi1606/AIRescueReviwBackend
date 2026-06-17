/**
 * One-time migration: backfill review_date_parsed for all existing reviews
 * Run: node backfill_review_dates.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Review = require("./models/Review");

function parseReviewDateString(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;

  const clean = dateStr
    .trim()
    .replace(/^(reviewed|reviewed on|posted on|stayed in)\s*:?\s*/i, '')
    .replace(/\s+on\s+.*$/i, '')
    .trim()
    .toLowerCase();

  if (!clean) return null;

  // Handle relative dates: "X hours/days/weeks/months ago", "a day ago", "yesterday", "today"
  const now = new Date();

  if (clean === "today" || clean === "just now") return now;
  if (clean === "yesterday") return new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // "a day ago", "an hour ago"
  const singleMatch = clean.match(/^(a|an)\s+(minute|hour|day|week|month)s?\s+ago$/);
  if (singleMatch) {
    const unit = singleMatch[2];
    const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
    return new Date(now.getTime() - (ms[unit] || 86400000));
  }

  // "X hours ago", "X days ago", etc.
  const relMatch = clean.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/);
  if (relMatch) {
    const count = parseInt(relMatch[1]);
    const unit = relMatch[2];
    const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
    return new Date(now.getTime() - count * (ms[unit] || 86400000));
  }

  // Try direct parse for standard date formats
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) return parsed;

  // Try "15 may 2026" format
  const dmyMatch = clean.match(/^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/);
  if (dmyMatch) {
    const p = new Date(`${dmyMatch[2]} ${dmyMatch[1]}, ${dmyMatch[3]}`);
    if (!isNaN(p.getTime())) return p;
  }

  // Try "march 2025" format
  const monthYearMatch = clean.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/);
  if (monthYearMatch) {
    const p = new Date(`1 ${monthYearMatch[1]} ${monthYearMatch[2]}`);
    if (!isNaN(p.getTime())) return p;
  }

  return null;
}

async function backfill() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const reviews = await Review.find({ review_date: { $exists: true, $ne: null } });
  console.log(`Found ${reviews.length} reviews to process`);

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of reviews) {
    const parsed = parseReviewDateString(r.review_date);
    if (parsed) {
      if (r.review_date_parsed && r.review_date_parsed.getTime() === parsed.getTime()) {
        skipped++;
        continue;
      }
      r.review_date_parsed = parsed;
      await r.save();
      updated++;
    } else {
      console.log(`  Could not parse: "${r.review_date}"`);
      failed++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Skipped (already set): ${skipped}, Failed: ${failed}`);
  await mongoose.disconnect();
}

backfill().catch(err => {
  console.error(err);
  process.exit(1);
});
