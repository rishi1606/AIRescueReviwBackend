const mongoose = require("mongoose");
require("dotenv").config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  
  console.log("\nUsers:");
  const users = await db.collection("users").find().toArray();
  console.log(users);

  console.log("\nStaffs:");
  const staffs = await db.collection("staffs").find().toArray();
  console.log(staffs);

  console.log("\nHotels:");
  const hotels = await db.collection("hotels").find().toArray();
  console.log(hotels);

  process.exit();
}

check();
