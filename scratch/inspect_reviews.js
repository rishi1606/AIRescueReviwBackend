const mongoose = require("mongoose");
require("dotenv").config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const reviews = await db.collection("reviews").find().toArray();
  console.log("Reviews details:");
  reviews.forEach(r => {
    console.log(`- ID: ${r._id}, hotel_id: ${r.hotel_id}, hotel_name: ${r.hotel_name}, guest: ${r.guest_name}`);
  });
  process.exit();
}

check();
