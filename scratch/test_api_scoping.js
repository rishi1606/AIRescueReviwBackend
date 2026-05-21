const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const Staff = require("../models/Staff");
const Review = require("../models/Review");
const Ticket = require("../models/Ticket");
const reviewController = require("../controllers/getReviews" in require("../controllers/reviewController") ? "../controllers/reviewController" : "../controllers/reviewController");
const ticketController = require("../controllers/ticketController");

async function runTest() {
  console.log("Connecting to Database...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Database Connected successfully.");

  // Find a GM to get the correct hotel_id
  const gm = await Staff.findOne({ role: "gm" });
  if (!gm) {
    console.error("No GM user found in database. Cannot run test.");
    process.exit(1);
  }
  console.log(`Found GM User: ${gm.name} (Hotel ID: ${gm.hotelId})`);

  // Ensure we have some test reviews and tickets in the database with multiple departments
  // Let's check what departments exist in our DB
  const reviewsCount = await Review.countDocuments({ hotel_id: gm.hotelId });
  const ticketsCount = await Ticket.countDocuments({ hotel_id: gm.hotelId });
  console.log(`Total Reviews: ${reviewsCount}, Total Tickets: ${ticketsCount}`);

  // Create temporary mock reviews and tickets for F&B and Housekeeping to perform proper scoping tests
  const testReviews = [
    {
      review_id: "REV-TEST-FB",
      guest_name: "John Doe",
      reviewer_name: "John Doe",
      rating: 4,
      review_text: "Great food at the restaurant!",
      platform: "Google",
      primary_department: "Food & Beverage",
      hotel_id: gm.hotelId,
      status: "NEW",
      review_date: new Date()
    },
    {
      review_id: "REV-TEST-HK",
      guest_name: "Jane Smith",
      reviewer_name: "Jane Smith",
      rating: 2,
      review_text: "Dirty room and sheets.",
      platform: "Booking.com",
      primary_department: "Housekeeping",
      hotel_id: gm.hotelId,
      status: "NEW",
      review_date: new Date()
    }
  ];

  const testTickets = [
    {
      ticket_id: "TCK-TEST-FB",
      guest_name: "John Doe",
      review_text: "Great food at the restaurant!",
      department: "Food & Beverage",
      urgency: "Medium",
      status: "Open",
      hotel_id: gm.hotelId,
      created_at: Date.now(),
      sla_deadline: Date.now() + 24 * 3600 * 1000
    },
    {
      ticket_id: "TCK-TEST-HK",
      guest_name: "Jane Smith",
      review_text: "Dirty room and sheets.",
      department: "Housekeeping",
      urgency: "High",
      status: "Open",
      hotel_id: gm.hotelId,
      created_at: Date.now(),
      sla_deadline: Date.now() + 4 * 3600 * 1000
    }
  ];

  // Insert mock data for testing
  await Review.deleteMany({ review_id: { $in: ["REV-TEST-FB", "REV-TEST-HK"] } });
  await Ticket.deleteMany({ ticket_id: { $in: ["TCK-TEST-FB", "TCK-TEST-HK"] } });

  await Review.insertMany(testReviews);
  await Ticket.insertMany(testTickets);
  console.log("Mock test reviews and tickets inserted successfully.");

  // Test Case 1: Scoped Staff Role (F&B)
  const scopedUser = {
    id: new mongoose.Types.ObjectId(),
    hotel_id: gm.hotelId,
    role: "staff",
    department: "Food & Beverage"
  };

  console.log("\n--- Testing Scoped Staff Role (Food & Beverage) ---");

  // 1.1 Test Reviews Endpoint
  const mockReqReviewsStaff = {
    query: {},
    user: scopedUser
  };

  let staffReviewsData = null;
  const mockResReviewsStaff = {
    json: function(data) {
      staffReviewsData = data.data.reviews;
    }
  };

  await reviewController.getReviews(mockReqReviewsStaff, mockResReviewsStaff, (err) => console.error(err));

  console.log(`Staff getReviews returned ${staffReviewsData.length} reviews.`);
  const nonFBReviews = staffReviewsData.filter(r => r.primary_department !== "Food & Beverage");
  if (nonFBReviews.length > 0) {
    console.error("❌ FAILURE: Scoped staff user saw reviews outside their department!", nonFBReviews);
    process.exit(1);
  }
  console.log("✅ SUCCESS: Staff review list is perfectly restricted to 'Food & Beverage'!");

  // 1.2 Test Tickets Endpoint
  const mockReqTicketsStaff = {
    query: {},
    user: scopedUser
  };

  let staffTicketsData = null;
  const mockResTicketsStaff = {
    json: function(data) {
      staffTicketsData = data.data.tickets;
    }
  };

  await ticketController.getTickets(mockReqTicketsStaff, mockResTicketsStaff, (err) => console.error(err));

  console.log(`Staff getTickets returned ${staffTicketsData.length} tickets.`);
  const nonFBTickets = staffTicketsData.filter(t => t.department !== "Food & Beverage");
  if (nonFBTickets.length > 0) {
    console.error("❌ FAILURE: Scoped staff user saw tickets outside their department!", nonFBTickets);
    process.exit(1);
  }
  console.log("✅ SUCCESS: Staff ticket list is perfectly restricted to 'Food & Beverage'!");


  // Test Case 2: GM Role (Unscoped)
  const gmUser = {
    id: gm._id,
    hotel_id: gm.hotelId,
    role: "gm"
  };

  console.log("\n--- Testing GM Role (Unscoped) ---");

  // 2.1 Test Reviews Endpoint for GM
  const mockReqReviewsGM = {
    query: {},
    user: gmUser
  };

  let gmReviewsData = null;
  const mockResReviewsGM = {
    json: function(data) {
      gmReviewsData = data.data.reviews;
    }
  };

  await reviewController.getReviews(mockReqReviewsGM, mockResReviewsGM, (err) => console.error(err));

  console.log(`GM getReviews returned ${gmReviewsData.length} reviews.`);
  const fbReviewsGM = gmReviewsData.filter(r => r.primary_department === "Food & Beverage");
  const hkReviewsGM = gmReviewsData.filter(r => r.primary_department === "Housekeeping");
  console.log(`F&B reviews seen by GM: ${fbReviewsGM.length}`);
  console.log(`Housekeeping reviews seen by GM: ${hkReviewsGM.length}`);

  if (fbReviewsGM.length === 0 || hkReviewsGM.length === 0) {
    console.error("❌ FAILURE: GM should be able to see reviews from all departments.");
    process.exit(1);
  }
  console.log("✅ SUCCESS: GM review list correctly displays multiple departments!");

  // 2.2 Test Tickets Endpoint for GM
  const mockReqTicketsGM = {
    query: {},
    user: gmUser
  };

  let gmTicketsData = null;
  const mockResTicketsGM = {
    json: function(data) {
      gmTicketsData = data.data.tickets;
    }
  };

  await ticketController.getTickets(mockReqTicketsGM, mockResTicketsGM, (err) => console.error(err));

  console.log(`GM getTickets returned ${gmTicketsData.length} tickets.`);
  const fbTicketsGM = gmTicketsData.filter(t => t.department === "Food & Beverage");
  const hkTicketsGM = gmTicketsData.filter(t => t.department === "Housekeeping");
  console.log(`F&B tickets seen by GM: ${fbTicketsGM.length}`);
  console.log(`Housekeeping tickets seen by GM: ${hkTicketsGM.length}`);

  if (fbTicketsGM.length === 0 || hkTicketsGM.length === 0) {
    console.error("❌ FAILURE: GM should be able to see tickets from all departments.");
    process.exit(1);
  }
  console.log("✅ SUCCESS: GM ticket list correctly displays multiple departments!");


  // Clean up mock data
  await Review.deleteMany({ review_id: { $in: ["REV-TEST-FB", "REV-TEST-HK"] } });
  await Ticket.deleteMany({ ticket_id: { $in: ["TCK-TEST-FB", "TCK-TEST-HK"] } });
  console.log("\nMock test data cleaned up successfully.");

  mongoose.connection.close();
  console.log("Database connection closed. Test completed successfully.");
}

runTest().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
