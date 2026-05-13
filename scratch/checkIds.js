const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const Review = require('../models/Review');
require('dotenv').config();

async function checkIds() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const staff = await Staff.findOne({ email: 'raj@gmail.com' });
  const review = await Review.findOne({ reviewer_name: 'Kevin Hart' });
  
  console.log("Staff Hotel ID:", staff.hotelId);
  console.log("Review Hotel ID:", review.hotel_id);
  console.log("Are they equal?", staff.hotelId.toString() === review.hotel_id.toString());
  
  process.exit();
}

checkIds();
