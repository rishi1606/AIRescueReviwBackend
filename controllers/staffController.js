const Staff = require("../models/Staff");
const bcrypt = require("bcryptjs");

exports.getStaff = async (req, res, next) => {
  try {
    const { department, status } = req.query;
    let query = { hotelId: req.user.hotel_id };

    if (department && department !== "ALL") query.department = department;
    if (status && status !== "ALL") query.status = status;

    const staff = await Staff.find(query).select("-password").sort({ name: 1 });
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

exports.addStaff = async (req, res, next) => {
  try {
    let { name, email, password, role, department } = req.body;
    
    // Validation
    if (!name || !email || !password || !department) {
      return res.status(400).json({ success: false, error: "Name, email, password, and department are required" });
    }

    const existing = await Staff.findOne({ email });
    if (existing) return res.status(400).json({ success: false, error: "Staff with this email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const staff = new Staff({
      name,
      email,
      password: hashedPassword,
      role: role || 'staff',
      department,
      hotelId: req.user.hotel_id,
      avatar_initials: name.split(" ").map(n => n[0]).join("").toUpperCase(),
      onboarding_complete: true,
      inviteStatus: "Active"
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
    const { name, email, role, department, status, inviteStatus } = req.body;
    
    const staff = await Staff.findOneAndUpdate(
      { _id: id, hotelId: req.user.hotel_id },
      { name, email, role, department, status, inviteStatus },
      { new: true, runValidators: true }
    ).select("-password");

    if (!staff) return res.status(404).json({ success: false, error: "Staff not found" });

    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

exports.disableStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const staff = await Staff.findOneAndUpdate(
      { _id: id, hotelId: req.user.hotel_id },
      { status: 'disabled' },
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
    const staff = await Staff.findOne({ _id: id, hotelId: req.user.hotel_id });
    
    if (staff && staff.role === "gm") {
      return res.status(400).json({ success: false, error: "Cannot remove General Manager" });
    }

    await Staff.findOneAndDelete({ _id: id, hotelId: req.user.hotel_id });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
};
