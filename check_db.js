require("dotenv").config();
const mongoose = require("mongoose");
const ImportBatch = require("./models/ImportBatch");
const Review = require("./models/Review");


async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const batches = await ImportBatch.find().sort({ createdAt: -1 }).limit(5);
  console.log("Recent Batches:");
  batches.forEach(b => console.log(`ID: ${b._id}, Status: ${b.status}, Count: ${b.validCount}, Errors: ${b.errors}`));

  const reviews = await Review.find().sort({ createdAt: -1 }).limit(5);
  console.log("\nRecent Reviews:");
  reviews.forEach(r => console.log(`ID: ${r.review_id}, Name: ${r.guest_name}, Text: ${r.review_text.substring(0, 50)}...`));

  process.exit();
}

check();
