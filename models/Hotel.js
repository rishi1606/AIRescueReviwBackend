const mongoose = require("mongoose");

const hotelSchema = new mongoose.Schema({
  hotel_name: { type: String, required: true },
  address: { type: String },
  number_of_rooms: { type: String },
  star_category: { type: String },
  platforms: [String],
  sla_high: { type: Number, default: 4 },
  sla_medium: { type: Number, default: 24 },
  sla_low: { type: Number, default: 72 },
  ai_confidence_threshold: { type: Number, default: 75 },
  auto_ticket_threshold: { type: String, default: "High+Medium" },
  default_response_tone: { type: String, default: "Formal" },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

module.exports = mongoose.model("Hotel", hotelSchema);
