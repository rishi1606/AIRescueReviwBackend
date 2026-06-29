const mongoose = require('mongoose');
const Staff = require('../models/Staff');

const PROD_URI = 'mongodb://gamerslog280_db_user:r8nD0HSN8gqMQYtf@ac-kdwdpci-shard-00-00.lqazojs.mongodb.net:27017,ac-kdwdpci-shard-00-01.lqazojs.mongodb.net:27017,ac-kdwdpci-shard-00-02.lqazojs.mongodb.net:27017/reviewrescue_prod?ssl=true&replicaSet=atlas-39sgsc-shard-0&authSource=admin&appName=reviewplatform';

async function updateAdminEmail() {
  try {
    console.log('🔄 Connecting to production database...');
    await mongoose.connect(PROD_URI);
    console.log('✅ Connected!');

    // Update superadmin email
    const result = await Staff.findOneAndUpdate(
      { role: 'superadmin' },
      { email: 'admin@gmail.com' },
      { new: true }
    );

    if (result) {
      console.log('✅ Superadmin email updated!');
      console.log('   Email:    admin@gmail.com');
      console.log('   Password: password123');
      console.log('   Role:     superadmin');
    } else {
      console.log('⚠️  No superadmin found');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

updateAdminEmail();
