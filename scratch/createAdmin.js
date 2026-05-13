const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const Hotel = require('../models/Hotel');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createAdmin() {
  await mongoose.connect(process.env.MONGO_URI);
  
  // Find first hotel
  const hotel = await Hotel.findOne();
  if (!hotel) {
    console.error("No hotel found. Please register a hotel first.");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash('password123', 10);
  
  const admin = new Staff({
    name: "General Manager",
    email: "admin@gmail.com",
    password: hashedPassword,
    role: "gm",
    department: "Management",
    hotelId: hotel._id,
    avatar_initials: "GM",
    onboarding_complete: true,
    status: "active"
  });

  await admin.save();
  console.log("Admin account created: admin@gmail.com / password123");
  process.exit();
}

createAdmin();
