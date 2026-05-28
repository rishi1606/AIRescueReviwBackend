require("dotenv").config();
const mongoose = require("mongoose");
const ScrapeProgress = require("./models/ScrapeProgress");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const result = await ScrapeProgress.updateOne(
    { property_name: "Manhattan Avenue Hotel", platform: "Booking.com" },
    { $set: { historical_done: true } }
  );

  console.log("Updated Manhattan Avenue Hotel Booking.com progress:", result);
  process.exit();
}

run();
