// ═══════════════════════════════════════════════════════════════════════════
// RBAC MIDDLEWARE - Role-Based Access Control
// ═══════════════════════════════════════════════════════════════════════════

const Staff = require("../models/Staff");

// ───────────────────────────────────────────────────────────────────────────
// CHECK IF USER HAS ONE OF THE ALLOWED ROLES
// ───────────────────────────────────────────────────────────────────────────
exports.requireRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated. Please login first."
        });
      }

      // Check if user has allowed role
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: `Access denied. This action requires one of: ${allowedRoles.join(", ")}`
        });
      }

      next();
    } catch (err) {
      console.error("RBAC role check error:", err);
      return res.status(500).json({
        success: false,
        error: "Authorization check failed"
      });
    }
  };
};

// ───────────────────────────────────────────────────────────────────────────
// CHECK BUSINESS ISOLATION - Owner can only access their own business
// ───────────────────────────────────────────────────────────────────────────
exports.requireOwnBusiness = async (req, res, next) => {
  try {
    // Superadmin can access anything
    if (req.user.role === "superadmin") {
      return next();
    }

    // Owner must be accessing their own business
    if (req.user.role === "owner") {
      const business_id = req.body.business_id || req.query.business_id;

      if (!business_id) {
        return res.status(400).json({
          success: false,
          error: "business_id is required"
        });
      }

      // If owner has business_id set, verify it matches
      // If not set, allow access (will be set from /hotel endpoint)
      if (req.user.business_id) {
        if (req.user.business_id.toString() !== business_id.toString()) {
          return res.status(403).json({
            success: false,
            error: "You can only access your own business"
          });
        }
      }
    }

    next();
  } catch (err) {
    console.error("Business isolation check error:", err);
    return res.status(500).json({
      success: false,
      error: "Authorization check failed"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// CHECK STAFF OWNERSHIP - Staff can only manage their own data
// ───────────────────────────────────────────────────────────────────────────
exports.requireOwnStaff = async (req, res, next) => {
  try {
    // Superadmin and owner can access any staff
    if (req.user.role === "superadmin" || req.user.role === "owner") {
      return next();
    }

    // Staff can only access their own profile
    if (req.user.role === "staff") {
      const staffId = req.params.id;

      if (!staffId) {
        return res.status(400).json({
          success: false,
          error: "Staff ID is required"
        });
      }

      // Check if accessing own profile
      if (req.user._id.toString() !== staffId.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only access your own profile"
        });
      }
    }

    next();
  } catch (err) {
    console.error("Staff ownership check error:", err);
    return res.status(500).json({
      success: false,
      error: "Authorization check failed"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// CHECK REVIEW OWNERSHIP - Can only access reviews from own business
// ───────────────────────────────────────────────────────────────────────────
exports.requireOwnReview = async (req, res, next) => {
  try {
    const Review = require("../models/Review");
    const mongoose = require("mongoose");
    const reviewId = req.params.id;

    if (!reviewId) {
      return res.status(400).json({
        success: false,
        error: "Review ID is required"
      });
    }

    // Superadmin can access any review
    if (req.user.role === "superadmin") {
      return next();
    }

    // Fetch review by review_id field (not MongoDB _id)
    const review = await Review.findOne({ review_id: reviewId });
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // Owner: Check if review belongs to their business
    if (req.user.role === "owner") {
      const staff = await Staff.findById(req.user._id);
      if (!staff || !staff.business_id) {
        return res.status(403).json({
          success: false,
          error: "You don't have access to this review"
        });
      }

      // Note: Review model might use hotel_id, business_id, or different field
      // Adjust based on actual Review schema
      if (review.hotel_id && review.hotel_id.toString() !== staff.business_id.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only access reviews from your own business"
        });
      }
    }

    // Lead: Check if review is assigned to their team
    if (req.user.role === "lead") {
      // Lead can access reviews assigned to their team members
      const teamMembers = await Staff.find({
        reporting_to: req.user._id,
        is_active: true
      }).select("_id");

      const teamIds = teamMembers.map(m => m._id.toString());
      teamIds.push(req.user._id.toString()); // Include themselves

      const assignedId = review.assigned_to_staff_id?.toString();
      if (assignedId && !teamIds.includes(assignedId)) {
        return res.status(403).json({
          success: false,
          error: "You can only access reviews from your team"
        });
      }
    }

    // Staff: Can view reviews from their business
    if (req.user.role === "staff") {
      // Try to find staff by _id first, then by email
      let staff = await Staff.findById(req.user._id);

      if (!staff && req.user.email) {
        staff = await Staff.findOne({ email: req.user.email });
      }

      console.log("Staff lookup for", req.user._id, "or", req.user.email, ":", staff);

      if (!staff || !staff.business_id) {
        return res.status(403).json({
          success: false,
          error: "Staff profile not found or not linked to a business"
        });
      }

      // Staff can view reviews from their business
      // Review might use hotel_id or business_id, so check both
      const reviewBusinessId = review.hotel_id || review.business_id;
      console.log("Review business_id:", reviewBusinessId, "Staff business_id:", staff.business_id);

      if (reviewBusinessId && reviewBusinessId.toString() !== staff.business_id.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only access reviews from your own business"
        });
      }
    }

    next();
  } catch (err) {
    console.error("Review ownership check error:", err);
    return res.status(500).json({
      success: false,
      error: "Authorization check failed: " + err.message
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// CHECK RESPONSE APPROVAL RIGHTS - Can only approve team/own responses
// ───────────────────────────────────────────────────────────────────────────
exports.requireApprovalRights = async (req, res, next) => {
  try {
    const Review = require("../models/Review");
    const reviewId = req.params.id;

    // Only superadmin, owner, and lead can approve
    const allowedRoles = ["superadmin", "owner", "lead"];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "Only leads and owners can approve responses"
      });
    }

    // Superadmin can approve anything
    if (req.user.role === "superadmin") {
      return next();
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // Owner: Can approve any response in their business
    if (req.user.role === "owner") {
      return next();
    }

    // Lead: Can only approve responses from their team
    if (req.user.role === "lead") {
      const submittedBy = review.submitted_by;
      const teamMembers = await Staff.find({
        reporting_to: req.user._id,
        is_active: true
      }).select("_id name");

      const teamMemberIds = teamMembers.map(m => m._id.toString());
      const assignedId = review.assigned_to_staff_id?.toString();

      if (assignedId && !teamMemberIds.includes(assignedId)) {
        return res.status(403).json({
          success: false,
          error: "You can only approve responses from your team"
        });
      }
    }

    next();
  } catch (err) {
    console.error("Approval rights check error:", err);
    return res.status(500).json({
      success: false,
      error: "Authorization check failed"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// CHECK ASSIGNMENT RIGHTS - Can only assign to own business staff
// ───────────────────────────────────────────────────────────────────────────
exports.requireAssignmentRights = async (req, res, next) => {
  try {
    const staff_id = req.body.assigned_to_staff_id;

    if (!staff_id) {
      return res.status(400).json({
        success: false,
        error: "Staff ID is required"
      });
    }

    // Only superadmin, owner, and lead can assign
    const allowedRoles = ["superadmin", "owner", "lead"];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: "Only owners and leads can assign reviews"
      });
    }

    // Superadmin can assign to anyone
    if (req.user.role === "superadmin") {
      return next();
    }

    // Fetch the staff being assigned to
    const targetStaff = await Staff.findById(staff_id);
    if (!targetStaff) {
      return res.status(404).json({
        success: false,
        error: "Target staff member not found"
      });
    }

    // Owner: Can only assign to staff in their business
    if (req.user.role === "owner") {
      if (targetStaff.business_id.toString() !== req.user.business_id.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only assign to staff in your own business"
        });
      }
    }

    // Lead: Can only assign to their team members
    if (req.user.role === "lead") {
      if (targetStaff.reporting_to?.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only assign to staff on your team"
        });
      }
    }

    next();
  } catch (err) {
    console.error("Assignment rights check error:", err);
    return res.status(500).json({
      success: false,
      error: "Authorization check failed"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// CHECK SUBMISSION RIGHTS - Can only submit for own assigned reviews
// ───────────────────────────────────────────────────────────────────────────
exports.requireSubmissionRights = async (req, res, next) => {
  try {
    const Review = require("../models/Review");
    const reviewId = req.params.id;

    // Everyone can submit
    if (!reviewId) {
      return res.status(400).json({
        success: false,
        error: "Review ID is required"
      });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // Superadmin and owner can submit for anyone
    if (req.user.role === "superadmin" || req.user.role === "owner") {
      return next();
    }

    // Lead can submit for their team
    if (req.user.role === "lead") {
      const assignedId = review.assigned_to_staff_id?.toString();
      if (!assignedId) {
        return res.status(400).json({
          success: false,
          error: "Review is not assigned"
        });
      }

      const teamMembers = await Staff.find({
        reporting_to: req.user._id,
        is_active: true
      }).select("_id");

      const teamIds = teamMembers.map(m => m._id.toString());
      if (!teamIds.includes(assignedId)) {
        return res.status(403).json({
          success: false,
          error: "You can only submit responses for your team"
        });
      }

      return next();
    }

    // Staff can only submit for their own assigned reviews
    if (req.user.role === "staff") {
      const assignedId = review.assigned_to_staff_id?.toString();
      if (assignedId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only submit responses for reviews assigned to you"
        });
      }
    }

    next();
  } catch (err) {
    console.error("Submission rights check error:", err);
    return res.status(500).json({
      success: false,
      error: "Authorization check failed"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// PERMISSION MATRIX BUILDER - Easy way to check multiple permissions
// ───────────────────────────────────────────────────────────────────────────
const PERMISSION_MATRIX = {
  // STAFF MANAGEMENT
  "staff:create": ["superadmin", "owner"],
  "staff:read": ["superadmin", "owner", "lead"],
  "staff:update": ["superadmin", "owner"],
  "staff:delete": ["superadmin", "owner"],

  // REVIEW ASSIGNMENT
  "review:assign": ["superadmin", "owner", "lead"],
  "review:unassign": ["superadmin", "owner", "lead"],
  "review:read": ["superadmin", "owner", "lead", "staff"],
  "review:submit": ["superadmin", "owner", "lead", "staff"],

  // RESPONSE APPROVAL
  "response:approve": ["superadmin", "owner", "lead"],
  "response:reject": ["superadmin", "owner", "lead"],
  "response:view-pending": ["superadmin", "owner", "lead"],

  // QUEUE ACCESS
  "queue:my": ["superadmin", "owner", "lead", "staff"],
  "queue:team": ["superadmin", "owner", "lead"],
  "queue:all": ["superadmin", "owner"],

  // ADMIN ACTIONS
  "admin:view": ["superadmin", "owner"],
  "flag:create": ["superadmin", "owner", "lead", "staff"],
};

exports.checkPermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated"
        });
      }

      const allowedRoles = PERMISSION_MATRIX[permission];

      if (!allowedRoles) {
        console.warn(`Unknown permission: ${permission}`);
        return res.status(500).json({
          success: false,
          error: "Permission check failed"
        });
      }

      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: `You don't have permission to: ${permission}`
        });
      }

      next();
    } catch (err) {
      console.error("Permission check error:", err);
      return res.status(500).json({
        success: false,
        error: "Authorization check failed"
      });
    }
  };
};

// ───────────────────────────────────────────────────────────────────────────
// GET USER'S PERMISSIONS - Return what user can do
// ───────────────────────────────────────────────────────────────────────────
exports.getUserPermissions = (userRole) => {
  const permissions = [];

  Object.entries(PERMISSION_MATRIX).forEach(([action, roles]) => {
    if (roles.includes(userRole)) {
      permissions.push(action);
    }
  });

  return permissions;
};

module.exports.PERMISSION_MATRIX = PERMISSION_MATRIX;
