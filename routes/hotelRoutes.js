const express = require("express");
const router = express.Router();
const hotelController = require("../controllers/hotelController");
const auth = require("../middleware/auth");

router.get("/", auth, hotelController.getHotel);
router.put("/", auth, hotelController.updateHotel);
router.post("/complete-onboarding", auth, hotelController.completeOnboarding);

module.exports = router;
