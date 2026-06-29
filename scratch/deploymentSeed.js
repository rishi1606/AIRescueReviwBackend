const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const Hotel = require('../models/Hotel');
const Review = require('../models/Review');
const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const ImportBatch = require('../models/ImportBatch');
const bcrypt = require('bcryptjs');

// Production MongoDB URI from .env
const PROD_URI = 'mongodb://gamerslog280_db_user:r8nD0HSN8gqMQYtf@ac-kdwdpci-shard-00-00.lqazojs.mongodb.net:27017,ac-kdwdpci-shard-00-01.lqazojs.mongodb.net:27017,ac-kdwdpci-shard-00-02.lqazojs.mongodb.net:27017/?ssl=true&replicaSet=atlas-39sgsc-shard-0&authSource=admin&appName=reviewplatform';

async function deploymentSeed() {
  try {
    console.log('🚀 Starting deployment seed...');
    console.log('Connecting to production database...');
    await mongoose.connect(PROD_URI);
    console.log('✅ Connected to production database!');

    // Clear all collections
    console.log('\n🗑️  Clearing all collections...');
    await Review.deleteMany({});
    console.log('✅ Cleared Reviews');

    await Ticket.deleteMany({});
    console.log('✅ Cleared Tickets');

    await Notification.deleteMany({});
    console.log('✅ Cleared Notifications');

    await ImportBatch.deleteMany({});
    console.log('✅ Cleared ImportBatches');

    await Staff.deleteMany({});
    console.log('✅ Cleared Staff');

    await Hotel.deleteMany({});
    console.log('✅ Cleared Hotels');

    // Create Superadmin
    console.log('\n👤 Creating superadmin...');
    const hashedPassword = await bcrypt.hash('password123', 10);

    const superadmin = new Staff({
      name: 'Super Admin',
      email: 'admin@reviewrescue.com',
      password: hashedPassword,
      role: 'superadmin',
      department: 'Management',
      avatar_initials: 'SA',
      onboarding_complete: true,
      is_active: true
    });

    await superadmin.save();
    console.log('✅ Superadmin created successfully!');
    console.log('   Email:    admin@reviewrescue.com');
    console.log('   Password: password123');
    console.log('   Role:     superadmin');

    console.log('\n✨ Deployment seed completed successfully!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

deploymentSeed();
