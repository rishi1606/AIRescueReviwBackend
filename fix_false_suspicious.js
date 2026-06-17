const mongoose = require('mongoose');
require('dotenv').config();
const Review = require('./models/Review');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  // Fix reviews that are 4-5 stars + Positive/Neutral but wrongly marked suspicious
  const result = await Review.updateMany(
    { is_suspicious: true, rating: { $gte: 4 }, sentiment: { $in: ['Positive', 'Neutral'] } },
    { $set: { is_suspicious: false, suspicious_reason: null, status: 'Classified' } }
  );
  console.log('Fixed', result.modifiedCount, 'false-positive suspicious reviews');
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
