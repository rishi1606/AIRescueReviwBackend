const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Core fields
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  hotelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true },

  // Notification type
  type: {
    type: String,
    enum: [
      // Staff workflow types
      'ticket_assigned', 'assign', 'response_pending_approval', 'submitted', 'response_approved', 'lead_approved', 'response_rejected',
      'review_rejected', 'bo_rejected', 'published', 'superadmin_published', 'ticket_reassigned', 'escalation_alert', 'ticket_closed',
      // User-facing types
      'success', 'warning', 'info', 'import', 'new_review', 'escalated'
    ],
    required: true
  },

  priority: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low'],
    default: 'medium'
  },

  message: { type: String, required: true },
  title: { type: String, default: '' },

  // Related resources
  relatedTicketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  relatedReviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'Review' },

  // Action metadata
  actionData: {
    staffName: String,
    guestName: String,
    reviewRating: Number,
    department: String,
    rejectionReason: String,
    gmComment: String,
    assignedFromStaffId: mongoose.Schema.Types.ObjectId
  },

  // Legacy fields (backward compatible)
  link_to: { type: String, default: null },
  review_id: { type: String, default: null },
  actor: { type: String, default: 'System' },

  // Read status
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  read_by: [{ type: String }],

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(+new Date() + 30*24*60*60*1000) }
});

// Indexes for performance
notificationSchema.index({ recipientId: 1, hotelId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, isRead: 1 });
notificationSchema.index({ hotelId: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

module.exports = mongoose.model('Notification', notificationSchema);
