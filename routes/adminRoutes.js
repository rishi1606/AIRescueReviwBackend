const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const adminController = require("../controllers/adminController");

// All routes require auth + superadmin role
router.use(auth, adminOnly);

// Businesses
router.get("/businesses", adminController.getBusinesses);
router.post("/businesses", adminController.addBusiness);
router.put("/businesses/:id", adminController.updateBusiness);
router.delete("/businesses/:id", adminController.deleteBusiness);
router.patch("/businesses/:id/toggle-active", adminController.toggleBusinessActive);

// Properties (cross-business)
router.get("/properties", adminController.getAllProperties);
router.post("/properties", adminController.addPropertyToAnyBusiness);
router.put("/properties/:propertyId", adminController.updateAnyProperty);
router.delete("/properties/:propertyId", adminController.deleteAnyProperty);
router.patch("/properties/:propertyId/toggle-active", adminController.togglePropertyActive);

module.exports = router;
