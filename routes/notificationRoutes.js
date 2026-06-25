const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

// Create notification
router.post('/', auth, notificationController.createNotification);

// Get all notifications for current user
router.get('/', auth, notificationController.getNotifications);

// Get unread count
router.get('/unread/count', auth, notificationController.getUnreadCount);

// Get single notification by ID
router.get('/:notificationId', auth, notificationController.getNotificationById);

// Mark single notification as read
router.put('/:notificationId/read', auth, notificationController.markAsRead);

// Mark all notifications as read
router.put('/read-all', auth, notificationController.markAllAsRead);

// Delete notification
router.delete('/:notificationId', auth, notificationController.deleteNotification);

module.exports = router;
