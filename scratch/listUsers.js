const mongoose = require('mongoose');
const Staff = require('../models/Staff');
require('dotenv').config();

async function listUsers() {
  await mongoose.connect(process.env.MONGO_URI);
  const users = await Staff.find({}, { name: 1, email: 1, role: 1 });
  console.log(JSON.stringify(users, null, 2));
  process.exit();
}

listUsers();
