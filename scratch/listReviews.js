const mongoose = require('mongoose');
const Review = require('../models/Review');
require('dotenv').config();

async function listReviews() {
  await mongoose.connect(process.env.MONGO_URI);
  const reviews = await Review.find({}, { reviewer_name: 1, status: 1, confidence: 1 });
  console.log(JSON.stringify(reviews, null, 2));
  process.exit();
}

listReviews();
