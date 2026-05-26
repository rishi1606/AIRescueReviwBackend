const jwt = require("jsonwebtoken");
const Hotel = require("../models/Hotel");

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    // Fallback/Ensure hotel_id is populated and valid
    let hasHotel = false;
    if (req.user.hotel_id) {
      hasHotel = await Hotel.exists({ _id: req.user.hotel_id });
    }
    if (!hasHotel) {
      let hotel = await Hotel.findOne();
      if (!hotel) {
        hotel = new Hotel({
          hotel_name: "Default Hotel",
          number_of_rooms: 50,
          city: "Default City"
        });
        await hotel.save();
      }
      req.user.hotel_id = hotel._id.toString();
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
};
