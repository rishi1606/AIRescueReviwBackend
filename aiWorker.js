/**
 * aiWorker.js — Standalone AI Worker
 * ------------------------------------
 * Designed to run as a Render Cron Job every 5 minutes.
 *
 * What it does:
 *   1. Connects to MongoDB
 *   2. Finds up to 5 unprocessed reviews (is_processed: false, retry_count < 3)
 *   3. Sends them to Groq API for sentiment/urgency analysis
 *   4. Saves results back to MongoDB
 *   5. Exits cleanly (process.exit(0))
 *
 * Environment variables required:
 *   MONGODB_URI  — MongoDB connection string
 *   GROQ_API_KEY — Groq API key
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { runAIWorker } = require('./services/cronService');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGODB_URI) {
  console.error('[AI Worker] FATAL: No MongoDB URI found. Set MONGODB_URI env var.');
  process.exit(1);
}

if (!process.env.GROQ_API_KEY) {
  console.error('[AI Worker] FATAL: GROQ_API_KEY is not set.');
  process.exit(1);
}

const run = async () => {
  console.log('[AI Worker] Starting...');

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[AI Worker] MongoDB connected.');
  } catch (err) {
    console.error('[AI Worker] MongoDB connection failed:', err.message);
    process.exit(1);
  }

  try {
    await runAIWorker();
    console.log('[AI Worker] Batch complete.');
  } catch (err) {
    console.error('[AI Worker] Unexpected error during batch:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('[AI Worker] MongoDB disconnected. Exiting.');
    process.exit(0);
  }
};

run();
