const Hotel = require("../models/Hotel");
const User = require("../models/User");

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
    const hotel = await Hotel.findByIdAndUpdate(req.user.hotel_id, req.body, { new: true });
    res.json({ success: true, data: hotel });
  } catch (err) {
    next(err);
  }
};

exports.completeOnboarding = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.user.id, { onboarding_complete: true }, { new: true });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};
