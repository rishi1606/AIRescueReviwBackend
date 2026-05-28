require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("./models/Hotel");
const ScrapeProgress = require("./models/ScrapeProgress");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  const hotels = await Hotel.find({});
  console.log(`Found ${hotels.length} hotels.\n`);

  for (const hotel of hotels) {
    console.log(`Hotel: ${hotel.hotel_name} (${hotel._id})`);
    if (hotel.properties) {
      for (const prop of hotel.properties) {
        console.log(`  Property: ${prop.name} (Active: ${prop.is_active}, Max per sync: ${prop.max_reviews_per_sync})`);
        const platforms = prop.platforms || {};
        for (const [platform, url] of Object.entries(platforms)) {
          console.log(`    Platform: ${platform} -> ${url}`);
          const progress = await ScrapeProgress.findOne({
            hotel_id: hotel._id,
            property_name: prop.name,
            platform
          });
          if (progress) {
            console.log(`      Progress: historical_done=${progress.historical_done}, next_page=${progress.next_page}, last_synced_at=${progress.last_synced_at}`);
          } else {
            console.log(`      Progress: None (not initialized yet)`);
          }
        }
      }
    }
  }

  process.exit();
}

run();
