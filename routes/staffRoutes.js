const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const staffController = require('../controllers/staffController');

// ── STAFF MANAGEMENT ROUTES ─────────────────────────────────────────────────

// Create staff account
// POST /api/staff/create
router.post('/create', auth, staffController.createStaff);

// List all staff for a business
// GET /api/staff/list?business_id=xxx
router.get('/list', auth, staffController.getStaffByBusiness);

// Get current user profile
// GET /api/staff/me
router.get('/me', auth, staffController.getCurrentUser);

// Get staff by ID
// GET /api/staff/:id
router.get('/:id', auth, staffController.getStaffById);

// Update staff
// PUT /api/staff/:id
router.put('/:id', auth, staffController.updateStaff);

// Change password
// POST /api/staff/:id/change-password
router.post('/:id/change-password', auth, staffController.changePassword);

// Delete/Deactivate staff
// DELETE /api/staff/:id
router.delete('/:id', auth, staffController.deleteStaff);

module.exports = router;
