const express = require('express');
const router = express.Router();
const { initCronJobs } = require('../services/cronService');

// Manual reload of dynamic property crons
router.post('/reload', async (req, res, next) => {
  try {
    console.log('[API] Manual cron reload triggered');
    await initCronJobs();
    res.json({ success: true, message: "Crons reloaded with latest properties from DB." });
  } catch (err) {
    next(err);
  }
});

// Test all properties and tiers immediately
router.post('/test', async (req, res, next) => {
  try {
    const Hotel = require('../models/Hotel');
    const { processPropertyTier } = require('../services/cronService');
    
    const hotel = await Hotel.findOne();
    if (!hotel || !hotel.properties || hotel.properties.length === 0) {
      return res.json({ success: false, message: "No active properties found." });
    }

    const activeProps = hotel.properties.filter(p => p.is_active);
    console.log(`[API] Manual test triggered for ${activeProps.length} properties.`);

    // Run them sequentially so we don't crash the local PC with too many headless browsers
    for (const prop of activeProps) {
      // Run URGENT (1-3★)
      await processPropertyTier(hotel._id, prop, 'URGENT (TEST)', 1, 3);
      // Run LOW (4-5★)
      await processPropertyTier(hotel._id, prop, 'LOW (TEST)', 4, 5);
    }

    res.json({ success: true, message: "Test run completed for all urgencies. Check server console for logs." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
