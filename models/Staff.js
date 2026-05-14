const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ["superadmin", "gm", "dept_head", "staff"], 
    default: "staff" 
  },
  department: { 
    type: String, 
    enum: [
      "Front Office", "Reservations", "Concierge", "Guest Relations", "Housekeeping", 
      "Laundry", "Maintenance", "Engineering", "IT Support", "Security", "Valet", 
      "Parking", "Bell Desk", "Food & Beverage", "Restaurant", "Bar", "Room Service", 
      "Kitchen", "Banquet", "Events", "Spa", "Gym", "Pool", "Sales", "Marketing", 
      "Revenue Management", "Finance", "Billing", "Management", "Operations", 
      "Human Resources", "Airport Shuttle", "Transportation", "WiFi & Internet", 
      "Facilities", "Cleanliness", "Noise Control", "Accessibility", 
      "Check-in Experience", "Check-out Experience"
    ],
    required: true
  },
  hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" },
  avatar_initials: { type: String },
  onboarding_complete: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: ["active", "disabled"], 
    default: "active" 
  },
  inviteStatus: { 
    type: String, 
    enum: ["Pending", "Active"], 
    default: "Active" // For now, since we don't have real email verification yet
  }
}, { timestamps: true });

module.exports = mongoose.model("Staff", staffSchema);
