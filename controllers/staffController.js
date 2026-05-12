const User = require("../models/User");
const bcrypt = require("bcryptjs");

exports.getStaff = async (req, res, next) => {
  try {
    const staff = await User.find({ hotel_id: req.user.hotel_id }).select("-password");
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

exports.addStaff = async (req, res, next) => {
  try {
    let { name, email, password, role, department } = req.body;
    
    // Auto-generate credentials if not provided (internal staff tracking)
    if (!email) {
      const slug = name.toLowerCase().replace(/ /g, ".");
      email = `${slug}.${Date.now()}@internal.hotel`;
    }
    if (!password) {
      password = Math.random().toString(36).slice(-10);
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, error: "Staff with this email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const staff = new User({
      name,
      email,
      password: hashedPassword,
      role,
      department,
      hotel_id: req.user.hotel_id,
      avatar_initials: name.split(" ").map(n => n[0]).join("").toUpperCase(),
      onboarding_complete: true
    });
    await staff.save();
    
    const response = staff.toObject();
    delete response.password;
    res.status(201).json({ success: true, data: response });
  } catch (err) {
    next(err);
  }
};

exports.updateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, role, department } = req.body;
    const staff = await User.findOneAndUpdate(
      { _id: id, hotel_id: req.user.hotel_id },
      { name, email, role, department },
      { new: true }
    ).select("-password");
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

exports.removeStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    await User.findOneAndDelete({ _id: id, hotel_id: req.user.hotel_id });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
};
