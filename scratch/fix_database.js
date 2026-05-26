const mongoose = require("mongoose");
const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
require("dotenv").config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const targetHotelId = "6a1462aad47d138f9b2a799e"; // This matches all 12 reviews!

  // 1. Create or update the Hotel document with this ID
  let hotel = await Hotel.findById(targetHotelId);
  if (!hotel) {
    hotel = new Hotel({
      _id: new mongoose.Types.ObjectId(targetHotelId),
      hotel_name: "The Grand Palace",
      number_of_rooms: 100,
      city: "Mumbai",
      star_category: "4-Star",
      properties: [
        {
          name: "The Grand Palace",
          city: "Mumbai",
          rooms: 100,
          timezone: "IST",
          is_active: true,
          platforms: {
            "Google": "https://maps.google.com/?cid=12345",
            "Booking.com": "https://www.booking.com/hotel/in/grand-palace.html"
          }
        }
      ]
    });
    await hotel.save();
    console.log("Created hotel 'The Grand Palace' with ID:", targetHotelId);
  } else {
    console.log("Hotel 'The Grand Palace' already exists with ID:", targetHotelId);
  }

  // 2. Also create a hotel for the GM's current hotelId (6a1463ced47d138f9b2a79a7) just in case
  const gmHotelId = "6a1463ced47d138f9b2a79a7";
  let gmHotel = await Hotel.findById(gmHotelId);
  if (!gmHotel) {
    gmHotel = new Hotel({
      _id: new mongoose.Types.ObjectId(gmHotelId),
      hotel_name: "ReviewRescue Hotel",
      number_of_rooms: 120,
      city: "Mumbai",
      star_category: "5-Star"
    });
    await gmHotel.save();
    console.log("Created hotel 'ReviewRescue Hotel' with ID:", gmHotelId);
  }

  // 3. Also create a hotel for Rishi Shah's current hotel_id (6a02f0d5adf859a96da254d7) just in case
  const rishiHotelId = "6a02f0d5adf859a96da254d7";
  let rishiHotel = await Hotel.findById(rishiHotelId);
  if (!rishiHotel) {
    rishiHotel = new Hotel({
      _id: new mongoose.Types.ObjectId(rishiHotelId),
      hotel_name: "Rishi Hotel",
      number_of_rooms: 80,
      city: "Mumbai",
      star_category: "3-Star"
    });
    await rishiHotel.save();
    console.log("Created hotel 'Rishi Hotel' with ID:", rishiHotelId);
  }

  // 4. Update the staffs collection: set GM admin@gmail.com's hotelId to targetHotelId (so it matches the reviews!)
  const updatedStaff = await Staff.findOneAndUpdate(
    { email: "admin@gmail.com" },
    { hotelId: new mongoose.Types.ObjectId(targetHotelId) },
    { new: true }
  );
  if (updatedStaff) {
    console.log("Updated admin@gmail.com hotelId to:", targetHotelId);
  } else {
    console.log("admin@gmail.com not found in staffs collection");
  }

  // 5. Update the users collection (if it exists) to targetHotelId
  try {
    const usersColl = db.collection("users");
    const count = await usersColl.countDocuments();
    if (count > 0) {
      await usersColl.updateMany(
        {},
        { $set: { hotel_id: new mongoose.Types.ObjectId(targetHotelId) } }
      );
      console.log(`Updated ${count} users in 'users' collection to hotel_id:`, targetHotelId);
    }
  } catch (err) {
    console.log("No 'users' collection or error updating it:", err.message);
  }

  console.log("Database associations fixed successfully!");
  process.exit();
}

run().catch(console.error);
