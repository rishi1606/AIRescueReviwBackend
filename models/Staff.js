const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },

  // Role hierarchy
  role: {
    type: String,
    enum: ["superadmin", "owner", "property_manager", "staff"],
    default: "staff"
  },

  // Department for filtering reviews
  department: {
    type: String,
    enum: [
      "Front Desk", "Housekeeping", "Food & Beverage", "Maintenance", "Management"
    ],
    default: null
  },

  // Business & Property assignment
  business_id: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" },
  property_id: { type: String, default: null },

  // For backward compatibility
  hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" },

  // Who created this staff member
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },

  // Status
  is_active: { type: Boolean, default: true },

  // UI
  avatar_initials: { type: String },
  onboarding_complete: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model("Staff", staffSchema);
