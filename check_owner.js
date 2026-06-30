const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const Staff = require('./models/Staff');
    
    const owner = await Staff.findOne({ email: 'marriotadmin@gmail.com' });
    
    console.log('👤 Owner Details:');
    console.log('   Name: ' + owner.name);
    console.log('   Email: ' + owner.email);
    console.log('   Role: ' + owner.role);
    console.log('   Business ID: ' + owner.business_id);
    console.log('   Hotel ID: ' + owner.hotel_id);
    
    mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
