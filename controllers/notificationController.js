const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');

// POST /notifications — create a notification
exports.createNotification = async (req, res, next) => {
  try {
    const { type, message, title, priority, link_to, relatedTicketId, relatedReviewId } = req.body;
    const recipientId = req.user.id;
    const hotelId = req.user.hotel_id;

    if (!type || !message) {
      return res.status(400).json({ success: false, message: "type and message are required" });
    }

    const notification = new Notification({
      recipientId,
      hotelId,
      type,
      message,
      title: title || message,
      priority: priority || 'medium',
      link_to,
      relatedTicketId,
      relatedReviewId
    });

    await notification.save();

    res.status(201).json({
      success: true,
      data: notification
    });
  } catch (err) {
    next(err);
  }
};

// GET /notifications — fetch notifications for current user (staff)
exports.getNotifications = async (req, res, next) => {
  try {
    const staffId = req.user.id;
    const hotelId = req.user.hotel_id;
    const { limit = 20, skip = 0, type, isRead } = req.query;

    let query = {
      recipientId: staffId,
      hotelId: hotelId
    };

    if (type) query.type = type;
    if (isRead !== undefined) query.isRead = isRead === 'true';

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate("relatedTicketId", "ticket_id guest_name rating")
      .populate("relatedReviewId", "review_text rating")
      .exec();

    const total = await Notification.countDocuments(query);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total: total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: parseInt(skip) + parseInt(limit) < total
      }
    });
  } catch (err) {
    next(err);
  }
};

// GET /notifications/unread — get unread count for current user
exports.getUnreadCount = async (req, res, next) => {
  try {
    const staffId = req.user.id;
    const hotelId = req.user.hotel_id;

    const unreadCount = await notificationService.getUnreadCount(staffId, hotelId);

    res.json({
      success: true,
      data: {
        unreadCount: unreadCount
      }
    });
  } catch (err) {
    next(err);
  }
};

// PUT /notifications/:id/read — mark single notification as read
exports.markAsRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const staffId = req.user.id;

    const notification = await notificationService.markAsRead(notificationId, staffId);

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found"
      });
    }

    res.json({
      success: true,
      data: notification
    });
  } catch (err) {
    next(err);
  }
};

// PUT /notifications/read-all — mark all notifications as read
exports.markAllAsRead = async (req, res, next) => {
  try {
    const staffId = req.user.id;
    const hotelId = req.user.hotel_id;

    const result = await notificationService.markAllAsRead(staffId, hotelId);

    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /notifications/:id — delete a notification
exports.deleteNotification = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const staffId = req.user.id;

    const result = await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: staffId
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "Notification not found"
      });
    }

    res.json({
      success: true,
      data: { deleted: true }
    });
  } catch (err) {
    next(err);
  }
};

// GET /notifications/:id — get single notification details
exports.getNotificationById = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const staffId = req.user.id;

    const notification = await Notification.findOne({
      _id: notificationId,
      recipientId: staffId
    })
      .populate("relatedTicketId")
      .populate("relatedReviewId");

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found"
      });
    }

    res.json({
      success: true,
      data: notification
    });
  } catch (err) {
    next(err);
  }
};
