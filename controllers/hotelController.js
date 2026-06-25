const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Review = require("../models/Review");
const { initCronJobs } = require("../services/cronService");

exports.getHotel = async (req, res, next) => {
  try {
    let hotel;
    let hotelId = req.user?.hotel_id;

    // For Business Owner, use business_id; otherwise use hotel_id
    if (req.user?.role === 'owner' || req.user?.role === 'property_manager') {
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        hotelId = staff.business_id;
      }
    }

    if (hotelId) {
      hotel = await Hotel.findById(hotelId).lean();
    }
    if (!hotel) {
      hotel = await Hotel.findOne().lean();
    }
    if (!hotel) {
      const newHotel = new Hotel({
        hotel_name: "Default Hotel",
        number_of_rooms: 50,
        city: "Default City",
        properties: [
          {
            name: "Main Property",
            city: "Default City",
            rooms: 50
          }
        ]
      });
      await newHotel.save();
      hotel = newHotel.toObject();
    }

    if (hotel.properties) {
      for (const prop of hotel.properties) {
        prop.review_count = await Review.countDocuments({
          hotel_id: hotel._id,
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
      properties,
      keywordAlerts,
      responseTemplates
    } = req.body;

    // Validation
    if (hotel_name && hotel_name.length < 3) {
      return res.status(400).json({ success: false, message: "Hotel name must be at least 3 characters" });
    }
    if (number_of_rooms !== undefined && isNaN(number_of_rooms)) {
      return res.status(400).json({ success: false, message: "Number of rooms must be a number" });
    }

    let hotelId = req.user && req.user.hotel_id;
    let hotel;
    if (hotelId) {
      hotel = await Hotel.findById(hotelId);
    }
    if (!hotel) {
      hotel = await Hotel.findOne();
    }
    if (!hotel) {
      hotel = new Hotel({
        hotel_name: "Default Hotel",
        number_of_rooms: 50,
        city: "Default City"
      });
      await hotel.save();
    }

    if (hotel_name !== undefined) hotel.hotel_name = hotel_name;
    if (city !== undefined) hotel.city = city;
    if (address !== undefined) hotel.address = address;
    if (number_of_rooms !== undefined) hotel.number_of_rooms = number_of_rooms;
    if (star_category !== undefined) hotel.star_category = star_category;
    if (timezone !== undefined) hotel.timezone = timezone;
    if (platforms !== undefined) hotel.platforms = platforms;
    if (contact_email !== undefined) hotel.contact_email = contact_email;
    if (slaConfig !== undefined) hotel.slaConfig = slaConfig;
    if (deptSlaConfig !== undefined) hotel.deptSlaConfig = deptSlaConfig;
    if (aiConfig !== undefined) hotel.aiConfig = aiConfig;
    if (properties !== undefined) hotel.properties = properties;
    if (keywordAlerts !== undefined) hotel.keywordAlerts = keywordAlerts;
    if (responseTemplates !== undefined) hotel.responseTemplates = responseTemplates;

    await hotel.save();

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
