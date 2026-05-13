const Staff = require("../models/Staff");
const Hotel = require("../models/Hotel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, department, hotel_name } = req.body;
    
    let staff = await Staff.findOne({ email });
    if (staff) return res.status(400).json({ success: false, error: "Staff already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create Hotel first
    const hotel = new Hotel({
      hotel_name,
      created_by: null // Will update after staff creation
    });
    await hotel.save();

    staff = new Staff({
      name,
      email,
      password: hashedPassword,
      role,
      department,
      hotelId: hotel._id,
      avatar_initials: name.split(" ").map(n => n[0]).join("").toUpperCase(),
      onboarding_complete: false
    });
    await staff.save();

    hotel.created_by = staff._id;
    await hotel.save();

    const token = jwt.sign(
      { 
        id: staff._id, 
        hotel_id: hotel._id,
        role: staff.role
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "24h" }
    );

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: staff._id,
          name: staff.name,
          email: staff.email,
          role: staff.role,
          hotel_id: staff.hotelId,
          onboarding_complete: staff.onboarding_complete
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const staff = await Staff.findOne({ email }).populate("hotelId");
    if (!staff) return res.status(400).json({ success: false, error: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, staff.password);
    if (!isMatch) return res.status(400).json({ success: false, error: "Invalid email or password" });

    const token = jwt.sign(
      { 
        id: staff._id, 
        hotel_id: staff.hotelId?._id || staff.hotelId, 
        role: staff.role 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: staff._id,
          name: staff.name,
          email: staff.email,
          role: staff.role,
          department: staff.department,
          hotel_id: staff.hotelId?._id || staff.hotelId,
          hotel_name: staff.hotelId?.hotel_name,
          onboarding_complete: staff.onboarding_complete
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const staff = await Staff.findById(req.user.id).populate("hotelId");
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

exports.updateMe = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const staff = await Staff.findById(req.user.id);
    
    if (name) staff.name = name;
    if (email) staff.email = email;
    if (password) staff.password = await bcrypt.hash(password, 10);
    
    await staff.save();
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};
