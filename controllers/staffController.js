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

    // Check if email already exists
    const exists = await Staff.findOne({ email: email.toLowerCase() });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Email already in use"
      });
    }

    // Department validation: Staff requires a Lead in that department for this property
    if (role === 'staff' && department && property_id) {
      const departmentLeadCount = await Staff.countDocuments({
        business_id,
        property_id,
        department,
        role: 'lead',
        is_active: true
      });

      if (departmentLeadCount === 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot add Staff to "${department}" department without a Lead for this property. First add a Lead.`
        });
      }
    }

    // Property validation: Only 1 Lead per department per property
    if (role === 'lead' && property_id && department) {
      const existingLeadCount = await Staff.countDocuments({
        business_id,
        property_id,
        department,
        role: 'lead',
        is_active: true
      });

      if (existingLeadCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Only 1 Lead allowed per department per property. "${department}" already has a Lead for this property.`
        });
      }
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
    // Handle both query and params for flexibility
    const business_id = req.query.business_id || req.params.business_id;
    const current_user = req.user;

    // Validation
    if (!business_id) {
      return res.status(400).json({
        success: false,
        error: "business_id is required"
      });
    }

    // Build query - get all staff for the business (no role filter)
    let query = { business_id, is_active: true };

    // Authorization check for owner and lead
    if ((current_user.role === 'owner' || current_user.role === 'lead') && current_user.business_id) {
      // Owner/Lead can only see staff from their own business
      if (current_user.business_id.toString() !== business_id) {
        return res.status(403).json({
          success: false,
          error: "You can only view staff from your own business"
        });
      }
    } else if (current_user.role !== 'superadmin' && current_user.role !== 'owner' && current_user.role !== 'lead') {
      return res.status(403).json({
        success: false,
        error: "Only owners, admins, and leads can view staff"
      });
    }

    const staff = await Staff.find(query)
      .select('-password')
      .populate('created_by', 'name email')
      .sort({ role: 1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      total: staff.length,
      data: staff
    });
  } catch (err) {
    console.error('Get staff by business error:', err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch staff list"
    });
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

// GET CURRENT USER
exports.getCurrentUser = async (req, res, next) => {
  try {
    if (!req.user || (!req.user._id && !req.user.email)) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated"
      });
    }

    // Try to find by _id first, then by email
    let staff = await Staff.findById(req.user._id)
      .select('-password')
      .populate('created_by', 'name email');

    // If not found by ID, try by email
    if (!staff && req.user.email) {
      staff = await Staff.findOne({ email: req.user.email })
        .select('-password')
        .populate('created_by', 'name email');
    }

    if (!staff) {
      return res.status(404).json({
        success: false,
        error: "User profile not found"
      });
    }

    // If staff has property_id, fetch the property to get hotel_name
    let hotel_name = null;
    if (staff.property_id) {
      const Property = require('../models/Property');
      const property = await Property.findById(staff.property_id).select('name');
      hotel_name = property?.name || null;
    }

    // Return staff data with hotel_name
    const staffData = staff.toObject ? staff.toObject() : staff;
    return res.status(200).json({
      success: true,
      data: {
        ...staffData,
        hotel_name: hotel_name
      }
    });
  } catch (err) {
    console.error('Get current user error:', err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch user profile"
    });
  }
};

// CHANGE PASSWORD
exports.changePassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Current password and new password are required"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters"
      });
    }

    // Get staff member
    const staff = await Staff.findById(id);
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: "Staff member not found"
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, staff.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: "Current password is incorrect"
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    staff.password = hashedPassword;
    await staff.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({
      success: false,
      error: "Failed to change password"
    });
  }
};

// GET STAFF BY ID
exports.getStaffById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Staff ID is required"
      });
    }

    const staff = await Staff.findById(id)
      .select('-password')
      .populate('created_by', 'name email')
      .populate('reporting_to', 'name role department');

    if (!staff) {
      return res.status(404).json({
        success: false,
        error: "Staff member not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: staff
    });
  } catch (err) {
    console.error('Get staff by ID error:', err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch staff member"
    });
  }
};
