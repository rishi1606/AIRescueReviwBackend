const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Review = require("../models/Review");
const { initCronJobs } = require("../services/cronService");

exports.getHotel = async (req, res, next) => {
  try {
    const hotel = await Hotel.findById(req.user.hotel_id).lean();
    if (hotel && hotel.properties) {
      for (const prop of hotel.properties) {
        prop.review_count = await Review.countDocuments({
          hotel_id: req.user.hotel_id,
          property_name: prop.name
        });
      }
    }
    res.json({ success: true, data: hotel });
  } catch (err) {
    next(err);
  }
};

exports.updateHotel = async (req, res, next) => {
  try {
    const { 
      hotel_name, 
      city, 
      address, 
      number_of_rooms, 
      star_category, 
      timezone, 
      platforms, 
      contact_email,
      slaConfig,
      deptSlaConfig,
      aiConfig,
      properties
    } = req.body;

    // Validation
    if (hotel_name && hotel_name.length < 3) {
      return res.status(400).json({ success: false, message: "Hotel name must be at least 3 characters" });
    }
    if (number_of_rooms !== undefined && isNaN(number_of_rooms)) {
      return res.status(400).json({ success: false, message: "Number of rooms must be a number" });
    }

    const hotel = await Hotel.findByIdAndUpdate(
      req.user.hotel_id, 
      { 
        hotel_name, 
        city, 
        address, 
        number_of_rooms, 
        star_category, 
        timezone, 
        platforms, 
        contact_email,
        slaConfig,
        deptSlaConfig,
        aiConfig,
        properties
      }, 
      { new: true, runValidators: true }
    );

    // Dynamic auto-reload of crons!
    try {
      await initCronJobs();
    } catch (cronErr) {
      console.error("[Cron] Failed to reload crons after hotel update:", cronErr);
    }
 
    res.json({ success: true, data: hotel });
  } catch (err) {
    next(err);
  }
};

exports.completeOnboarding = async (req, res, next) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.user.id, { onboarding_complete: true }, { new: true });
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};
