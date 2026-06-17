const Notification = require('../models/Notification');

// GET /notifications — fetch latest 50 notifications
const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    // Map read status for the current user
    const userId = req.user?._id?.toString() || req.user?.id || 'unknown';
    const mapped = notifications.map(n => ({
      _id: n._id,
      type: n.type,
      title: n.title,
      message: n.message,
      link_to: n.link_to,
      review_id: n.review_id,
      actor: n.actor,
      read: (n.read_by || []).includes(userId),
      created_at: n.created_at,
      timestamp: new Date(n.created_at).getTime()
    }));

    res.json(mapped);
  } catch (err) {
    console.error('[Notifications] Fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// POST /notifications — create a new notification
const createNotification = async (req, res) => {
  try {
    const { type, title, message, link_to, review_id, actor } = req.body;

    const notification = await Notification.create({
      type: type || 'info',
      title: title || '',
      message,
      link_to: link_to || null,
      review_id: review_id || null,
      actor: actor || req.user?.name || 'System',
      created_at: new Date()
    });

    res.status(201).json({
      _id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link_to: notification.link_to,
      review_id: notification.review_id,
      actor: notification.actor,
      read: false,
      created_at: notification.created_at,
      timestamp: new Date(notification.created_at).getTime()
    });
  } catch (err) {
    console.error('[Notifications] Create error:', err);
    res.status(500).json({ error: 'Failed to create notification' });
  }
};

// PUT /notifications/:id/read — mark a single notification as read for current user
const markAsRead = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id || 'unknown';
    await Notification.updateOne(
      { _id: req.params.id },
      { $addToSet: { read_by: userId } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

// PUT /notifications/read-all — mark all notifications as read for current user
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id || 'unknown';
    await Notification.updateMany(
      { read_by: { $ne: userId } },
      { $addToSet: { read_by: userId } }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Mark all read error:', err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

// DELETE /notifications/:id — delete a notification
const deleteNotification = async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

module.exports = {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification
};
