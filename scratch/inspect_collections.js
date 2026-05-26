const mongoose = require("mongoose");
require("dotenv").config();

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  console.log("Collections:", collections.map(c => c.name));
  for (const coll of collections) {
    const count = await db.collection(coll.name).countDocuments();
    console.log(`- ${coll.name}: ${count} documents`);
  }
  process.exit();
}

check();
