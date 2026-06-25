const Staff = require('../models/Staff');
const Hotel = require('../models/Hotel');
const bcrypt = require('bcryptjs');

// CREATE staff member
exports.createStaff = async (req, res, next) => {
  try {
    const { name, email, password, role, department, business_id, property_id } = req.body;
    const created_by = req.user.id;
    const current_user = req.user;

    // Validate required fields
    if (!name || !email || !password || !role || !business_id) {
      return res.status(400).json({
        success: false,
        message: "name, email, password, role, and business_id are required"
      });
    }

    // Validate role creation permissions
    if (current_user.role === 'superadmin' && role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: "Superadmin can only create Business Owners"
      });
    } else if (current_user.role === 'owner' && role !== 'property_manager') {
      return res.status(403).json({
        success: false,
        message: "Business Owner can only create Property Managers"
      });
    } else if (current_user.role === 'property_manager' && role !== 'staff') {
      return res.status(403).json({
        success: false,
        message: "Property Manager can only create Staff"
      });
    } else if (current_user.role !== 'superadmin' && current_user.role !== 'owner' && current_user.role !== 'property_manager') {
      return res.status(403).json({
        success: false,
        message: "You cannot create staff"
      });
    }

    // Check if email already exists
    const exists = await Staff.findOne({ email: email.toLowerCase() });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Email already in use"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create staff
    const staff = new Staff({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      department: department || null,
      business_id,
      property_id: property_id || null,
      created_by,
      is_active: true,
      avatar_initials: name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    });

    await staff.save();

    res.status(201).json({
      success: true,
      data: {
        _id: staff._id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        department: staff.department,
        business_id: staff.business_id,
        property_id: staff.property_id,
        is_active: staff.is_active
      }
    });
  } catch (err) {
    next(err);
  }
};

// GET all staff for a business
exports.getStaffByBusiness = async (req, res, next) => {
  try {
    const { business_id } = req.params;
    const current_user = req.user;

    // Build query based on user role
    let query = { business_id };

    if (current_user.role === 'superadmin') {
      // Superadmin sees all staff
      query = { business_id };
    } else if (current_user.role === 'owner') {
      // Business Owner sees only Property Managers
      query = { business_id, role: 'property_manager' };
    } else if (current_user.role === 'property_manager') {
      // Property Manager sees only Staff under their property
      const pmStaff = await Staff.findById(current_user.id);
      query = { business_id, property_id: pmStaff?.property_id, role: 'staff' };
    } else {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view staff"
      });
    }

    const staff = await Staff.find(query)
      .select('-password')
      .populate('created_by', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

// GET staff for a property
exports.getStaffByProperty = async (req, res, next) => {
  try {
    const { business_id, property_id } = req.params;

    const staff = await Staff.find({ business_id, property_id })
      .select('-password')
      .sort({ department: 1, name: 1 });

    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

// UPDATE staff
exports.updateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, department, is_active } = req.body;

    const staff = await Staff.findByIdAndUpdate(
      id,
      { name, role, department, is_active },
      { new: true }
    ).select('-password');

    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

// DELETE staff
exports.deleteStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    const staff = await Staff.findByIdAndDelete(id);

    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    res.json({ success: true, message: "Staff deleted" });
  } catch (err) {
    next(err);
  }
};

// DEACTIVATE staff (don't delete, just disable login)
exports.deactivateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    const staff = await Staff.findByIdAndUpdate(
      id,
      { is_active: false },
      { new: true }
    ).select('-password');

    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff not found" });
    }

    res.json({ success: true, data: staff, message: "Staff deactivated" });
  } catch (err) {
    next(err);
  }
};
