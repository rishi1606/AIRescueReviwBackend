const express = require("express");
const router = express.Router();
const staffController = require("../controllers/staffController");
const auth = require("../middleware/auth");

router.get("/", auth, staffController.getStaff);
router.post("/", auth, staffController.addStaff);
router.put("/:id", auth, staffController.updateStaff);
router.delete("/:id", auth, staffController.removeStaff);

module.exports = router;
