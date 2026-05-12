const User = require("../models/User");
const Hotel = require("../models/Hotel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, department, hotel_name } = req.body;
    
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ success: false, error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create Hotel first
    const hotel = new Hotel({
      hotel_name,
      created_by: null // Will update after user creation
    });
    await hotel.save();

    user = new User({
      name,
      email,
      password: hashedPassword,
      role,
      department,
      hotel_id: hotel._id,
      avatar_initials: name.split(" ").map(n => n[0]).join("").toUpperCase(),
      onboarding_complete: false
    });
    await user.save();

    hotel.created_by = user._id;
    await hotel.save();

    const token = jwt.sign({ id: user._id, hotel_id: hotel._id }, process.env.JWT_SECRET, { expiresIn: "24h" });

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          hotel_id: user.hotel_id,
          onboarding_complete: user.onboarding_complete
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
    const user = await User.findOne({ email }).populate("hotel_id");
    if (!user) return res.status(400).json({ success: false, error: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, error: "Invalid email or password" });

    const token = jwt.sign({ id: user._id, hotel_id: user.hotel_id?._id }, process.env.JWT_SECRET, { expiresIn: "24h" });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          hotel_id: user.hotel_id?._id,
          hotel_name: user.hotel_id?.hotel_name,
          onboarding_complete: user.onboarding_complete
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate("hotel_id");
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.updateMe = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const user = await User.findById(req.user.id);
    
    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = await bcrypt.hash(password, 10);
    
    await user.save();
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};
