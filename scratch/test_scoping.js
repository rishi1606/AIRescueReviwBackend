const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const Staff = require("../models/Staff");
const Hotel = require("../models/Hotel");
const staffController = require("../controllers/staffController");
const authController = require("../controllers/authController");

async function runTest() {
  console.log("Connecting to Database...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Database Connected successfully.");

  // 1. Get/Create a test hotel
  let hotel = await Hotel.findOne();
  if (!hotel) {
    console.log("No hotel found. Creating a test hotel...");
    hotel = new Hotel({
      hotel_name: "Grand Budapest Hotel"
    });
    await hotel.save();
  }
  console.log(`Using Hotel: ${hotel.hotel_name} (ID: ${hotel._id})`);

  // Clean up any existing test staff
  const testEmail = "teststaff_reviewrescue@gmail.com";
  await Staff.deleteOne({ email: testEmail });
  console.log("Cleaned up any previous test staff with email:", testEmail);

  // Mock req, res, next for addStaff
  const mockReqAdd = {
    body: {
      name: "Arthur Pendragon",
      email: testEmail,
      password: "ArthurSecurePassword123!",
      role: "staff",
      department: "Food & Beverage"
    },
    user: {
      hotel_id: hotel._id
    }
  };

  let addResult = null;
  const mockResAdd = {
    status: function(code) {
      console.log(`[Response Status]: ${code}`);
      return this;
    },
    json: function(data) {
      console.log("[Response JSON]:", JSON.stringify(data, null, 2));
      addResult = data;
      return this;
    }
  };

  const mockNext = (err) => {
    console.error("[Next Error Triggered]:", err);
  };

  console.log("\n--- Testing staffController.addStaff ---");
  await staffController.addStaff(mockReqAdd, mockResAdd, mockNext);

  if (!addResult || !addResult.success) {
    console.error("Failed to add staff member.");
    process.exit(1);
  }
  console.log("Staff member added successfully.");

  // Verify DB record
  const dbStaff = await Staff.findOne({ email: testEmail });
  console.log("\nVerified Mongoose DB Record:");
  console.log(`Name: ${dbStaff.name}`);
  console.log(`Department: ${dbStaff.department}`);
  console.log(`Role: ${dbStaff.role}`);
  console.log(`Password Hash: ${dbStaff.password}`);

  // Test Authentication / Login with the same credentials
  const mockReqLogin = {
    body: {
      email: testEmail,
      password: "ArthurSecurePassword123!"
    }
  };

  let loginResult = null;
  const mockResLogin = {
    status: function(code) {
      console.log(`[Login Response Status]: ${code}`);
      return this;
    },
    json: function(data) {
      console.log("[Login Response JSON]: Got token and user payload successfully.");
      loginResult = data;
      return this;
    }
  };

  console.log("\n--- Testing authController.login ---");
  await authController.login(mockReqLogin, mockResLogin, mockNext);

  if (!loginResult || !loginResult.success) {
    console.error("Failed to login with new staff credentials.");
    process.exit(1);
  }

  const { token, user } = loginResult.data;
  console.log("\nLogin Verification:");
  console.log("Returned User info:", JSON.stringify(user, null, 2));

  // Decode JWT token to check department payload
  const jwt = require("jsonwebtoken");
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  console.log("\nDecoded JWT Payload:");
  console.log(JSON.stringify(decoded, null, 2));

  if (decoded.department === "Food & Beverage") {
    console.log("\n🎉 SUCCESS: JWT token successfully signed with the 'Food & Beverage' department field!");
  } else {
    console.error(`\n❌ FAILURE: Expected department 'Food & Beverage', got '${decoded.department}'`);
    process.exit(1);
  }

  // Clean up test staff
  await Staff.deleteOne({ email: testEmail });
  console.log("Test account cleaned up.");

  mongoose.connection.close();
  console.log("Database connection closed. Test completed successfully.");
}

runTest().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
