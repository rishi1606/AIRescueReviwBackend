require("dotenv").config();
const mongoose = require("mongoose");
const Review = require("./models/Review");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const hotel_id = "6a15a5c9b5172bc86d3df6fb";
  const platform = "Booking.com";

  const existingDocs = await Review.find({ hotel_id, platform }).select('reviewer_name review_text');
  console.log(`Found ${existingDocs.length} existing docs in DB for hotel ${hotel_id} and platform ${platform}.`);
  
  existingDocs.forEach(doc => {
    console.log(`DB Key: "${doc.reviewer_name}${doc.review_text}"`);
  });

  const rawReviews = [
    {
      reviewerName: 'Mohamed',
      rating: 5,
      reviewDate: 'Reviewed: May 10, 2026',
      reviewText: 'Price was ok during this situation and the location is good'
    },
    {
      reviewerName: 'Vipul',
      rating: 5,
      reviewDate: 'Reviewed: April 7, 2026',
      reviewText: 'I will give stars 5 out of 10'
    }
  ];

  rawReviews.forEach(r => {
    const key = r.reviewerName + r.reviewText;
    console.log(`Scraper Key: "${key}"`);
    const match = existingDocs.some(doc => (doc.reviewer_name + doc.review_text) === key);
    console.log(`Match? ${match}`);
  });

  process.exit();
}

run();
