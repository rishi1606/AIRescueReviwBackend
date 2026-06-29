const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/reviewController");
const auth = require("../middleware/auth");

// ── MAIN ENDPOINTS ──────────────────────────────────────────────────────────
router.get("/", auth, reviewController.getReviews);
router.get("/pending-status", auth, reviewController.getPendingStatus);
router.post("/import", auth, reviewController.importReviews);
router.delete("/delete-all", auth, reviewController.deleteAllReviews);

// ── PHASE 4: REVIEW ASSIGNMENT & APPROVAL WORKFLOW ─────────────────────────

// Get my review queue (Staff/Lead/Owner)
router.get(
  "/queue/my",
  auth,
  reviewController.getMyQueue
);

// Get pending approvals (Lead/Owner only)
router.get(
  "/pending-approval",
  auth,
  reviewController.getPendingApprovals
);

// ── REVIEWER PROFILE (before :review_id to avoid collision) ────────────────
router.get(
  "/reviewer/:reviewer_name",
  auth,
  reviewController.getReviewerProfile
);

// ── REVIEW-SPECIFIC ROUTES ──────────────────────────────────────────────────
router.get(
  "/:id/detail",
  auth,
  reviewController.getReviewById
);

router.get(
  "/:id/similar",
  auth,
  reviewController.getSimilarReviews
);

// ── ASSIGNMENT ENDPOINTS ────────────────────────────────────────────────────

// Assign review to staff (Owner/Lead only)
router.post(
  "/:id/assign",
  auth,
  reviewController.assignReview
);

// Unassign review (Owner/Lead only)
router.post(
  "/:id/unassign",
  auth,
  reviewController.unassignReview
);

// ── RESPONSE & APPROVAL ENDPOINTS ───────────────────────────────────────────

// Submit response for approval (All roles)
router.post(
  "/:id/submit-response",
  auth,
  reviewController.submitResponse
);

// Approve response (Lead/Owner only)
router.post(
  "/:id/approve-response",
  auth,
  reviewController.approveResponse
);

// Reject response (Lead/Owner only)
router.post(
  "/:id/reject-response",
  auth,
  reviewController.rejectResponse
);

// ── OTHER REVIEW ENDPOINTS ──────────────────────────────────────────────────
router.put("/:id/classification", auth, reviewController.updateClassification);
router.put("/:id/flag-suspicious", auth, reviewController.flagSuspicious);
router.put("/:id/remove-flag", auth, reviewController.removeSuspiciousFlag);
router.post("/:id/notes", auth, reviewController.addNote);
router.put("/:id/reanalyse", auth, reviewController.reanalyse);
router.put("/:id/reopen", auth, reviewController.reopenReview);
router.put("/:id/assign-staff", auth, reviewController.assignStaff);
router.post("/:id/drafts", auth, reviewController.saveDraft);
router.delete("/:id", auth, reviewController.deleteReview);

module.exports = router;
