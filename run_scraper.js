require("dotenv").config();
const mongoose = require("mongoose");
const Hotel = require("./models/Hotel");
const { processPropertyTier } = require("./services/cronService");

async function runScraper() {
  const args = process.argv.slice(2);
  const tier = args[0] ? args[0].toUpperCase() : 'HIGH'; // HIGH or LOW

  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing in environment variables.");
    }
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    const hotels = await Hotel.find({});
    console.log(`Found ${hotels.length} hotels in database.\n`);

    for (const hotel of hotels) {
      if (!hotel.properties || hotel.properties.length === 0) continue;

      for (const prop of hotel.properties) {
        if (!prop.is_active) {
          console.log(`Skipping inactive property: ${prop.name}`);
          continue;
        }

        if (tier === 'HIGH') {
          console.log(`[GH-Action] Running HIGH tier scrape for ${prop.name} (1-3 stars)`);
          await processPropertyTier(hotel._id, prop, 'URGENT', 1, 3);
        } else if (tier === 'LOW') {
          console.log(`[GH-Action] Running LOW tier scrape for ${prop.name} (4-5 stars)`);
          await processPropertyTier(hotel._id, prop, 'LOW', 4, 5);
        }
      }
    }

    console.log("\nDone. Exiting.");
    process.exit(0);
  } catch (err) {
    console.error("FATAL ERROR:", err);
    process.exit(1);
  }
}

runScraper();
