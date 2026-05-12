const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  ticket_id: { type: String, required: true, unique: true },
  hotel_id: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },
  review_id: { type: String },
  guest_name: { type: String },
  guest_email: { type: String },
  room_number: { type: String },
  rating: { type: Number },
  platform: { type: String },
  review_text: { type: String },
  department: { type: String },
  all_departments: [String],
  issues: [String],
  suggested_action: { type: String },
  guest_emotion: { type: String },
  escalation_risk: { type: Boolean },
  urgency: { type: String },
  status: { type: String, default: "Open" },
  assignee_id: { type: String },
  assignee_name: { type: String, default: "Unassigned" },
  created_at: { type: Number },
  sla_deadline: { type: Number },
  resolved_at: { type: Number },
  closed_at: { type: Number },
  escalated: { type: Boolean, default: false },
  escalation_reason: { type: String },
  resolution_note: { type: String },
  is_recurring: { type: Boolean, default: false },
  recurring_count: { type: Number, default: 0 },
  cluster_id: { type: String },
  status_history: [{
    status: String,
    changed_by: String,
    timestamp: Number
  }],
  notes: [{
    text: String,
    author: String,
    timestamp: Number
  }],
  attachments: [{
    name: String,
    base64: String,
    timestamp: Number
  }]
}, { timestamps: true });

module.exports = mongoose.model("Ticket", ticketSchema);
