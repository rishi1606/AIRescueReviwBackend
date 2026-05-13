const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");

exports.getHotel = async (req, res, next) => {
  try {
    const hotel = await Hotel.findById(req.user.hotel_id);
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
      aiConfig
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
        aiConfig
      }, 
      { new: true, runValidators: true }
    );

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
