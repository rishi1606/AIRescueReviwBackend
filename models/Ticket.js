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
  primary_department: { type: String },
  all_departments: [String],
  issues: [String],
  suggested_action: { type: String },
  guest_emotion: { type: String },
  escalation_risk: { type: Boolean },
  urgency: { type: String },

  // Staff assignment & approval workflow fields
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  assignedToName: { type: String },
  assignedAt: { type: Date },

  // Approval workflow
  status: {
    type: String,
    enum: ["Unassigned", "Assigned", "In Progress", "Awaiting Approval", "Approved", "Closed", "Open"],
    default: "Unassigned"
  },
  approvalStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },
  proposedResponse: { type: String },
  proposedResponseSubmittedAt: { type: Date },
  approverNotes: { type: String },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  approvedByName: { type: String },
  approvedAt: { type: Date },

  // Escalation
  escalation: { type: Boolean, default: false },
  escalation_reason: { type: String },
  escalated: { type: Boolean, default: false },

  // Legacy fields (backward compatible)
  assignee_id: { type: String },
  assignee_name: { type: String, default: "Unassigned" },
  created_at: { type: Number },
  sla_deadline: { type: Number },
  acknowledged_at: { type: Number },
  resolved_at: { type: Number },
  closed_at: { type: Number },
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
  }],
  is_flagged: { type: Boolean, default: false },
  flag_reason: { type: String },
  resolution_duration_ms: { type: Number },
  property_name: { type: String }
}, { timestamps: true });

module.exports = mongoose.model("Ticket", ticketSchema);
