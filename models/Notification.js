const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  type: { type: String, default: 'info' }, // success, warning, info, error
  title: { type: String, default: '' },
  message: { type: String, required: true },
  link_to: { type: String, default: null },
  review_id: { type: String, default: null },
  actor: { type: String, default: 'System' },       // who triggered it
  read_by: [{ type: String }],                       // user IDs who read it
  created_at: { type: Date, default: Date.now },
  hotel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', default: null }
});

notificationSchema.index({ created_at: -1 });
notificationSchema.index({ hotel_id: 1, created_at: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
