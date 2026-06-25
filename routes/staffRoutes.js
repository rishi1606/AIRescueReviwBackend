const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const staffController = require('../controllers/staffController');

// Create staff
router.post('/', auth, staffController.createStaff);

// Get all staff for a business
router.get('/business/:business_id', auth, staffController.getStaffByBusiness);

// Get staff for a property
router.get('/business/:business_id/property/:property_id', auth, staffController.getStaffByProperty);

// Update staff
router.put('/:id', auth, staffController.updateStaff);

// Deactivate staff (soft delete)
router.patch('/:id/deactivate', auth, staffController.deactivateStaff);

// Delete staff (hard delete)
router.delete('/:id', auth, staffController.deleteStaff);

module.exports = router;
