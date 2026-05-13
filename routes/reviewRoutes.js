const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/reviewController");
const auth = require("../middleware/auth");

router.get("/", auth, reviewController.getReviews);
router.post("/import", auth, reviewController.importReviews);
router.put("/:review_id/classification", auth, reviewController.updateClassification);
router.put("/:review_id/approve-response", auth, reviewController.approveResponse);
router.put("/:review_id/reject-response", auth, reviewController.rejectResponse);
router.put("/:review_id/flag-suspicious", auth, reviewController.flagSuspicious);
router.post("/:review_id/notes", auth, reviewController.addNote);
router.put("/:review_id/reanalyse", auth, reviewController.reanalyse);
router.put("/:review_id/assign-staff", auth, reviewController.assignStaff);
router.delete("/delete-all", auth, reviewController.deleteAllReviews);

module.exports = router;
