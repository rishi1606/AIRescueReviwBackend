const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/reviewController");
const auth = require("../middleware/auth");

router.get("/", auth, reviewController.getReviews);
router.get("/pending-status", auth, reviewController.getPendingStatus);
router.post("/import", auth, reviewController.importReviews);
router.delete("/delete-all", auth, reviewController.deleteAllReviews);

// Reviewer profile (before :review_id to avoid collision)
router.get("/reviewer/:reviewer_name", auth, reviewController.getReviewerProfile);

// Review-specific routes
router.get("/:review_id/detail", auth, reviewController.getReviewById);
router.get("/:review_id/similar", auth, reviewController.getSimilarReviews);
router.put("/:review_id/classification", auth, reviewController.updateClassification);
router.put("/:review_id/approve-response", auth, reviewController.approveResponse);
router.put("/:review_id/reject-response", auth, reviewController.rejectResponse);
router.put("/:review_id/flag-suspicious", auth, reviewController.flagSuspicious);
router.put("/:review_id/remove-flag", auth, reviewController.removeSuspiciousFlag);
router.post("/:review_id/notes", auth, reviewController.addNote);
router.put("/:review_id/reanalyse", auth, reviewController.reanalyse);
router.put("/:review_id/reopen", auth, reviewController.reopenReview);
router.put("/:review_id/assign-staff", auth, reviewController.assignStaff);
router.post("/:review_id/drafts", auth, reviewController.saveDraft);
router.delete("/:review_id", auth, reviewController.deleteReview);

module.exports = router;
