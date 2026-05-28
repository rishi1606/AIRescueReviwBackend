require("dotenv").config();
const mongoose = require("mongoose");
const Review = require("./models/Review");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const reviews = await Review.find({ hotel_id: "6a15a5c9b5172bc86d3df6fb", platform: "Booking.com" });
  console.log(`Total reviews in DB: ${reviews.length}`);
  reviews.forEach((r, i) => {
    console.log(`${i+1}. ID: ${r.review_id}\n   Name: ${r.reviewer_name}\n   Text: ${r.review_text.substring(0, 60)}...`);
  });

  process.exit();
}

run();
