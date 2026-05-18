const mongoose = require("mongoose");

const hotelSchema = new mongoose.Schema({
  hotel_name: { 
    type: String, 
    required: true,
    minlength: 3
  },
  city: { type: String },
  address: { type: String },
  number_of_rooms: { 
    type: Number, 
    required: true 
  },
  star_category: { type: String },
  timezone: { type: String, default: "UTC" },
  platforms: {
    type: [String],
    default: ["Google", "TripAdvisor", "Booking.com", "Yelp"]
  },
  contact_email: { type: String }, // For escalations
  
  // SLA & AI Settings
  slaConfig: {
    high: { type: Number, default: 4 },
    medium: { type: Number, default: 24 },
    low: { type: Number, default: 72 }
  },
  deptSlaConfig: {
    "Front Office": { type: Number, default: 4 },
    "Housekeeping": { type: Number, default: 6 },
    "Maintenance": { type: Number, default: 4 },
    "F&B": { type: Number, default: 8 },
    "Management": { type: Number, default: 24 }
  },
  aiConfig: {
    confidenceThreshold: { type: Number, default: 75 },
    defaultTone: { type: String, default: "Formal" }, // Formal, Empathetic, Concise
    autoTicket: { type: Boolean, default: true },
    escalationAlert: { type: Boolean, default: true },
    escalationRatingThreshold: { type: Number, default: 2 } // Auto-escalate if rating <= 2
  },

  properties: [{
    name: { type: String, required: true },
    city: { type: String, required: true },
    rooms: { type: Number, required: true },
    timezone: { type: String, default: "IST" },
    is_active: { type: Boolean, default: true },
    platforms: { type: mongoose.Schema.Types.Mixed, default: {} },
    urgent_sync_interval: { type: String, default: "2hr" },
    low_sync_interval: { type: String, default: "6hr" }
  }],
  
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" }
}, { timestamps: true });

module.exports = mongoose.model("Hotel", hotelSchema);
