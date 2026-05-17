/**
 * Manual trigger: Run High Urgency scraping + AI processing NOW
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { runBookingScrape, runGoogleScrape, runExpediaScrape, runAgodaScrape, runAIWorker } = require("./services/cronService");

async function runHighUrgency() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    console.log("════════════════════════════════════════");
    console.log("  HIGH URGENCY — Scraping 1-2★ reviews");
    console.log("════════════════════════════════════════\n");

    // Scrape all 4 platforms, only save 1-2 star reviews
    console.log("[1/4] Booking.com...");
    await runBookingScrape(1, 2);

    console.log("\n[2/4] Google Maps...");
    await runGoogleScrape(1, 2);

    console.log("\n[3/4] Expedia...");
    await runExpediaScrape(1, 2);

    console.log("\n[4/4] Agoda...");
    await runAgodaScrape(1, 2);

    console.log("\n════════════════════════════════════════");
    console.log("  AI WORKER — Processing Pending Reviews");
    console.log("════════════════════════════════════════\n");

    await runAIWorker();

    console.log("\nDone. Exiting.");
    process.exit(0);
  } catch (err) {
    console.error("FATAL:", err);
    process.exit(1);
  }
}

runHighUrgency();
