const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const Hotel = require('../models/Hotel');
const bcrypt = require('bcryptjs');

// ── Atlas connection string (production) ──
const ATLAS_URI = 'mongodb://rishishahsr4_db_user:mypassword123@ac-thguvjg-shard-00-00.znfiicd.mongodb.net:27017,ac-thguvjg-shard-00-01.znfiicd.mongodb.net:27017,ac-thguvjg-shard-00-02.znfiicd.mongodb.net:27017/reviewrescue?ssl=true&replicaSet=atlas-vabogx-shard-0&authSource=admin&appName=ReviewRescue';

async function seedAtlas() {
  try {
    console.log('Connecting to Atlas...');
    await mongoose.connect(ATLAS_URI);
    console.log('✅ Connected to Atlas!');

    // Check if admin already exists
    const existing = await Staff.findOne({ email: 'admin@gmail.com' });
    if (existing) {
      console.log('⚠️  Admin user already exists in Atlas. Skipping.');
      process.exit(0);
    }

    // Create Hotel
    let hotel = await Hotel.findOne();
    if (!hotel) {
      hotel = new Hotel({
        hotel_name: 'ReviewRescue Hotel',
        number_of_rooms: 100,
        city: 'Mumbai',
        star_category: '4-Star',
        created_by: null
      });
      await hotel.save();
      console.log('✅ Hotel created:', hotel.hotel_name);
    } else {
      console.log('✅ Hotel already exists:', hotel.hotel_name);
    }

    // Create Admin Staff
    const hashedPassword = await bcrypt.hash('password123', 10);
    const admin = new Staff({
      name: 'General Manager',
      email: 'admin@gmail.com',
      password: hashedPassword,
      role: 'gm',
      department: 'Management',
      hotelId: hotel._id,
      avatar_initials: 'GM',
      onboarding_complete: true,
      status: 'active'
    });
    await admin.save();

    // Update hotel created_by
    hotel.created_by = admin._id;
    await hotel.save();

    console.log('✅ Admin created successfully!');
    console.log('   Email:    admin@gmail.com');
    console.log('   Password: password123');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

seedAtlas();
