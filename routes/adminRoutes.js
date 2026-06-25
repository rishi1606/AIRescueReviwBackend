const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const adminController = require("../controllers/adminController");

// All routes require auth
router.use(auth);

// Businesses - GET allowed for owner/property_manager, write operations for superadmin only
router.get("/businesses", adminController.getBusinesses);
router.post("/businesses", adminOnly, adminController.addBusiness);
router.put("/businesses/:id", adminOnly, adminController.updateBusiness);
router.delete("/businesses/:id", adminOnly, adminController.deleteBusiness);
router.patch("/businesses/:id/toggle-active", adminOnly, adminController.toggleBusinessActive);

// Properties (cross-business) - GET allowed for owner/property_manager, write operations for superadmin only
router.get("/properties", adminController.getAllProperties);
router.post("/properties", adminOnly, adminController.addPropertyToAnyBusiness);
router.put("/properties/:propertyId", adminOnly, adminController.updateAnyProperty);
router.delete("/properties/:propertyId", adminOnly, adminController.deleteAnyProperty);
router.patch("/properties/:propertyId/toggle-active", adminOnly, adminController.togglePropertyActive);

module.exports = router;
