const mongoose = require('mongoose');
require('dotenv').config();
const Staff = require('../models/Staff');
const Hotel = require('../models/Hotel');
const Review = require('../models/Review');
const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const ImportBatch = require('../models/ImportBatch');
const bcrypt = require('bcryptjs');

async function resetProdDb() {
  try {
    console.log('🚀 Connecting to MongoDB Atlas...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to Atlas!');

    // Completely drop the entire database and all its collections
    console.log('\n💥 Dropping the entire database (removing all collections completely)...');
    await mongoose.connection.db.dropDatabase();
    console.log('✅ Completely wiped database and removed all collections!');

    // Create Superadmin
    console.log('\n👤 Creating superadmin account...');
    const hashedPassword = await bcrypt.hash('password123', 10);

    const superadmin = new Staff({
      name: 'superadmin',
      email: 'admin@gmail.com',
      password: hashedPassword,
      role: 'superadmin',
      department: 'Management',
      avatar_initials: 'SA',
      onboarding_complete: true,
      is_active: true
    });

    await superadmin.save();
    console.log('✅ Superadmin created successfully!');
    console.log('   Name:     superadmin');
    console.log('   Email:    admin@gmail.com');
    console.log('   Password: password123');
    console.log('   Role:     superadmin');

    console.log('\n✨ Database reset and seeding completed successfully!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (mongoose.connection) await mongoose.connection.close();
    process.exit(1);
  }
}

resetProdDb();
