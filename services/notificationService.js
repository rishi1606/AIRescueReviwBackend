const Notification = require('../models/Notification');

exports.getUnreadCount = async (staffId, hotelId) => {
  const count = await Notification.countDocuments({
    recipientId: staffId,
    hotelId: hotelId,
    isRead: false
  });
  return count;
};

exports.markAsRead = async (notificationId, staffId) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      recipientId: staffId
    },
    { isRead: true },
    { new: true }
  );
  return notification;
};

exports.markAllAsRead = async (staffId, hotelId) => {
  const result = await Notification.updateMany(
    {
      recipientId: staffId,
      hotelId: hotelId,
      isRead: false
    },
    { isRead: true }
  );
  return result;
};
