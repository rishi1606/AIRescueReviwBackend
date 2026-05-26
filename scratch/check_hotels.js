const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");
require("dotenv").config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const hotels = await Hotel.find().lean();
  console.log("Hotels:", JSON.stringify(hotels, null, 2));
  process.exit();
}

check();
