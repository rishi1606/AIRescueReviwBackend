const express = require("express");
const router = express.Router();
const hotelController = require("../controllers/hotelController");
const auth = require("../middleware/auth");

router.get("/", auth, hotelController.getHotel);
router.put("/", auth, hotelController.updateHotel);
router.post("/complete-onboarding", auth, hotelController.completeOnboarding);

// Get properties endpoint - returns properties of the user's own hotel
router.get("/properties", auth, async (req, res, next) => {
  try {
    const Hotel = require("../models/Hotel");
    const Staff = require("../models/Staff");

    // For Business Owner, use business_id; otherwise use hotel_id
    let hotelId = req.user.hotel_id;
    if (req.user.role === 'owner' || req.user.role === 'property_manager') {
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        hotelId = staff.business_id;
      }
    }

    let hotel;
    if (hotelId) {
      hotel = await Hotel.findById(hotelId).select('properties hotel_name').lean();
      console.log(`[Properties] User hotel_id: ${hotelId}, Hotel found: ${hotel?.hotel_name}, Properties count: ${(hotel?.properties || []).length}`);
    }
    if (!hotel) {
      console.log(`[Properties] No hotel found for user hotel_id: ${hotelId}`);
      return res.json({ success: true, data: [] });
    }
    res.json({ success: true, data: hotel.properties || [] });
  } catch (err) {
    next(err);
  }
});

// Add property to user's own hotel (auto-linked)
router.post("/properties", auth, async (req, res, next) => {
  try {
    const Hotel = require("../models/Hotel");
    const Staff = require("../models/Staff");
    const { name, city, rooms, timezone, platforms, image, description, is_active } = req.body;

    if (!name || !city || !rooms) {
      return res.status(400).json({ success: false, message: "name, city, and rooms are required" });
    }

    // For Business Owner, use business_id; otherwise use hotel_id
    let hotelId = req.user.hotel_id;
    if (req.user.role === 'owner' || req.user.role === 'property_manager') {
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        hotelId = staff.business_id;
      }
    }

    const hotel = await Hotel.findById(hotelId);
    if (!hotel) {
      return res.status(404).json({ success: false, message: "Hotel not found" });
    }

    const newProperty = {
      name: name.trim(),
      city: city.trim(),
      rooms: parseInt(rooms),
      timezone: timezone || "IST",
      is_active: is_active !== false,
      platforms: platforms || {},
      image: image || "",
      description: description || ""
    };

    hotel.properties.push(newProperty);
    await hotel.save();

    const created = hotel.properties[hotel.properties.length - 1];
    res.status(201).json({ success: true, data: created, message: "Property added successfully" });
  } catch (err) {
    next(err);
  }
});

// Stub notification endpoints (local state only, no persistence)
router.get("/notifications", auth, (req, res) => {
  res.json({ success: true, data: [] });
});

router.post("/notifications", auth, (req, res) => {
  res.status(201).json({ success: true, message: "Notification noted" });
});

module.exports = router;
