const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

router.get('/stats', auth, dashboardController.getStats);
router.get('/sentiment-trend', auth, dashboardController.getSentimentTrend);
router.get('/recent-reviews', auth, dashboardController.getRecentReviews);

module.exports = router;
