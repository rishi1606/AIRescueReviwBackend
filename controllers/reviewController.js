const mongoose = require("mongoose");
const Review = require("../models/Review");
const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Ticket = require("../models/Ticket");
const workflowNotificationService = require("../services/workflowNotificationService");

// Helper: Build hotel filter (superadmin sees all, others see only their hotel)
const getHotelFilter = async (req) => {
  if (req.user.role === "superadmin") return {};

  const staff = await Staff.findById(req.user.id);
  const ids = new Set();

  if (req.user.hotel_id) ids.add(req.user.hotel_id.toString());
  if (req.user.business_id) ids.add(req.user.business_id.toString());

  if (staff) {
    if (staff.business_id) ids.add(staff.business_id.toString());
    if (staff.hotelId) ids.add(staff.hotelId.toString());
    if (staff.hotel_id) ids.add(staff.hotel_id.toString());
  }

  // Fallback: if no ID yet, find hotel by admin_email or created_by
  if (ids.size === 0 && staff && staff.email) {
    const hotel = await Hotel.findOne({ $or: [{ admin_email: staff.email }, { created_by: staff._id }] });
    if (hotel) {
      ids.add(hotel._id.toString());
      staff.business_id = hotel._id;
      staff.hotelId = hotel._id;
      await staff.save().catch(() => {});
    }
  }

  if (ids.size > 0) {
    const expandedArray = Array.from(ids);
    const childProps = await Hotel.find({ $or: [{ business_id: { $in: expandedArray } }, { _id: { $in: expandedArray } }] });
    childProps.forEach(p => {
      ids.add(p._id.toString());
      if (p.business_id) ids.add(p.business_id.toString());
    });
  }

  const validIds = Array.from(ids);
  if (validIds.length === 0) {
    return { hotel_id: null };
  } else if (validIds.length === 1) {
    return { hotel_id: validIds[0] };
  } else {
    return { hotel_id: { $in: validIds } };
  }
};

const findReviewByAnyId = async (id, filter = {}, userRole = "") => {
  if (!id) return null;
  const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
  const query = isObjectId ? { $or: [{ review_id: id }, { _id: id }] } : { review_id: id };
  let review = await Review.findOne({ ...query, ...filter });
  if (!review && userRole !== "staff" && Object.keys(filter).length > 0) {
    review = await Review.findOne(query);
  }
  return review;
};

exports.getReviews = async (req, res, next) => {
  console.log('🔷 [getReviews] CALLED! User:', req.user?.email, 'Role:', req.user?.role);
  try {
    const { sentiment, department, urgency, status, platform, property, rating, dateStart, dateEnd, search, page, limit, minConfidence, sortBy } = req.query;
    let query = await getHotelFilter(req);
    console.log('[getReviews] User role:', req.user.role, 'User dept:', req.user.department);

    if (sentiment && sentiment !== "ALL") query.sentiment = sentiment;

    // Scoping for standard staff, leads, and department heads
    if (req.user.role === "staff" || req.user.role === "lead" || req.user.role === "dept_head") {
      let userDept = req.user.department;
      if (!userDept) {
        const staff = await Staff.findById(req.user.id);
        if (staff) userDept = staff.department;
      }
      console.log('[getReviews] ' + req.user.role + ' department resolved:', userDept);
      if (userDept) {
        query.primary_department = userDept;
      }
    } else {
      if (department && department !== "ALL") query.primary_department = department;
    }
    console.log('[getReviews] Final query:', query);

    if (urgency && urgency !== "ALL") query.urgency = urgency;
    if (status && status !== "ALL") {
      if (status === "Suspicious") {
        if (!query.$and) query.$and = [];
        query.$and.push({ $or: [{ is_suspicious: true }, { status: "Suspicious" }] });
      } else if (status === "ESCALATED") {
        if (!query.$and) query.$and = [];
        query.$and.push({ $or: [{ escalation: true }, { status: "ESCALATED" }] });
      } else if (status.includes(",")) {
        query.status = { $in: status.split(",") };
      } else {
        query.status = status;
      }
    }
    if (platform && platform !== "ALL") query.platform = platform;
    if (property && property !== "ALL") query.hotel_name = property;
    if (rating && rating !== "ALL") query.rating = parseInt(rating);
    if (minConfidence) query.confidence = { $gte: parseInt(minConfidence) };

    if (dateStart || dateEnd) {
      // Use review_date_parsed (actual guest review date) with createdAt fallback
      const dateCondition = {};
      if (dateStart) dateCondition.$gte = new Date(dateStart);
      if (dateEnd) {
        const endDate = new Date(dateEnd);
        endDate.setHours(23, 59, 59, 999);
        dateCondition.$lte = endDate;
      }
      if (!query.$and) query.$and = [];
      query.$and.push({
        $or: [
          { review_date_parsed: { $ne: null, ...dateCondition } },
          { review_date_parsed: null, createdAt: dateCondition },
          { review_date_parsed: { $exists: false }, createdAt: dateCondition }
        ]
      });
    }

    if (search) {
      if (!query.$and) query.$and = [];
      query.$and.push({
        $or: [
          { reviewer_name: { $regex: search, $options: "i" } },
          { review_text: { $regex: search, $options: "i" } },
          // Also match AI-extracted highlights so topic filters from the
          // dashboard (e.g. "Location") return the same set they were counted in.
          { issues: { $regex: search, $options: "i" } },
          { positive_aspects: { $regex: search, $options: "i" } }
        ]
      });
    }

    const hotel = req.user.role === "superadmin" ? null : await Hotel.findById(req.user.hotel_id);
    const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);

    // Default sort
    let sortQuery = { imported_at: -1 };
    if (sortBy === "OLDEST") sortQuery = { imported_at: 1 };
    if (sortBy === "RATING_HIGH") sortQuery = { rating: -1 };
    if (sortBy === "RATING_LOW") sortQuery = { rating: 1 };
    if (sortBy === "CONFIDENCE_LOW") sortQuery = { confidence: 1 };

    let reviewsQuery = Review.find(query).sort(sortQuery);

    if (page && limit) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      reviewsQuery = reviewsQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const reviews = await reviewsQuery;
    const total = await Review.countDocuments(query);

    res.json({ success: true, data: { reviews, total } });
  } catch (err) {
    next(err);
  }
};

exports.importReviews = async (req, res, next) => {
  try {
    const { reviews } = req.body;
    let imported = 0;
    let skipped = 0;
    let errors = [];

    for (let r of reviews) {
      try {
        let query = { hotel_id: req.user.hotel_id };
        const orConditions = [{ review_id: r.review_id }];
        if (r.platform_review_id) {
          orConditions.push({ platform_review_id: r.platform_review_id });
        }

        const existing = await Review.findOne({
          hotel_id: req.user.hotel_id,
          $or: orConditions
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Parse review_date string into a proper Date
        let review_date_parsed = null;
        if (r.review_date) {
          try {
            const clean = r.review_date
              .trim()
              .replace(/^(reviewed|reviewed on|posted on|stayed in)\s*:?\s*/i, '')
              .replace(/\s+on\s+.*$/i, '')
              .trim()
              .toLowerCase();
            
            const now = new Date();
            if (clean === 'today' || clean === 'just now') {
              review_date_parsed = now;
            } else if (clean === 'yesterday') {
              review_date_parsed = new Date(now.getTime() - 86400000);
            } else {
              // "a day ago", "an hour ago"
              const singleMatch = clean.match(/^(a|an)\s+(minute|hour|day|week|month)s?\s+ago$/);
              if (singleMatch) {
                const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
                review_date_parsed = new Date(now.getTime() - (ms[singleMatch[2]] || 86400000));
              } else {
                // "X hours ago", "X days ago"
                const relMatch = clean.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/);
                if (relMatch) {
                  const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
                  review_date_parsed = new Date(now.getTime() - parseInt(relMatch[1]) * (ms[relMatch[2]] || 86400000));
                } else {
                  const parsed = new Date(clean);
                  if (!isNaN(parsed.getTime())) review_date_parsed = parsed;
                }
              }
            }
          } catch (e) { /* leave null */ }
        }

        const newReview = new Review({
          ...r,
          review_date_parsed,
          hotel_id: req.user.hotel_id,
          status: "NEW",
          imported_at: Date.now()
        });
        await newReview.save();
        imported++;
        await workflowNotificationService.notifyNewReviewImported(newReview);
        if (newReview.status === "ESCALATED" || newReview.escalation === true) {
          await workflowNotificationService.notifyEscalatedReview(newReview);
        }
      } catch (err) {
        errors.push({ row: r.review_id, reason: err.message });
      }
    }

    res.json({ success: true, data: { imported, skipped, errors } });
  } catch (err) {
    next(err);
  }
};

exports.updateClassification = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const hotel = await Hotel.findById(req.user.hotel_id);
    const extraction = req.body; // AI extracted sentiment, issues, department

    // Step 2 — Backend Logic Implementation
    const review = await Review.findOne({ review_id, ...await getHotelFilter(req) });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    // 1. Determine Urgency based on sentiment and rating
    let urgency = "Low";
    if (extraction.sentiment === "Negative") {
      urgency = review.rating <= 2 ? "High" : "Medium";
    } else if (extraction.sentiment === "Mixed") {
      urgency = "Medium";
    }

    // 2. Determine Status based on Hotel escalation rules & AI flags
    const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);
    let status = "IN REVIEW";
    const escalation = review.rating <= escalationThreshold;
    let is_suspicious = extraction.is_suspicious || false;
    let suspicious_reason = extraction.suspicious_reason || "";

    if (review.rating <= 1) {
      is_suspicious = true;
      suspicious_reason = "Auto-flagged: Rating is 1 star or below.";
      status = "Suspicious";
    } else if (is_suspicious) {
      status = "Suspicious";
    } else if (review.rating <= escalationThreshold) {
      status = "ESCALATED";
    } else if (extraction.is_factual_only && !review.linked_ticket_id) {
      status = "CLOSED";
    }

    // 3. Calculate Confidence — prefer AI's actual confidence, fallback to deterministic logic
    const confidence = extraction.confidence
      ? Math.min(100, Math.max(0, Math.round(extraction.confidence)))
      : (extraction.primary_department && extraction.sentiment ? 85 : 60);

    // 4. Validate & Store
    const needsHumanReview = confidence < (hotel?.aiConfig?.confidenceThreshold || 75);
    const classificationPayload = {
      ...extraction,
      urgency,
      confidence,
      status,
      escalation,
      escalation_reason: (() => {
        if (!escalation) return null;
        const displayRating = review.raw_rating != null ? `${review.raw_rating}/${review.raw_rating_scale}` : `${review.rating}/5`;
        const normalizedDisplay = review.raw_rating != null ? ` (normalized: ${review.rating}/5)` : '';
        return `Rating ${displayRating}${normalizedDisplay} is at or below escalation threshold (${escalationThreshold}/5)`;
      })(),
      is_suspicious,
      suspicious_reason,
      needs_human_review: needsHumanReview,
      human_review_reason: needsHumanReview
        ? `AI confidence (${confidence}%) is below the trust threshold (${hotel?.aiConfig?.confidenceThreshold || 75}%)`
        : null,
      ai_error: null,
      classified_at: Date.now()
    };

    const updatedReview = await Review.findOneAndUpdate(
      { review_id, ...await getHotelFilter(req) },
      { ...classificationPayload },
      { new: true }
    );

    if (updatedReview && (updatedReview.status === "ESCALATED" || updatedReview.escalation === true)) {
      await workflowNotificationService.notifyEscalatedReview(updatedReview);
    }

    res.json({ success: true, data: updatedReview });
  } catch (err) {
    next(err);
  }
};

exports.approveResponse = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const { response_text, response_tone, approved_by, is_submission } = req.body;

    // RBAC: Only Lead/Owner can approve directly. Staff MUST use is_submission=true.
    const isApprover = req.user.role === "gm" || req.user.role === "dept_head" || req.user.role === "superadmin" || req.user.role === "owner" || req.user.role === "lead";
    if (!isApprover && !is_submission) {
      return res.status(403).json({ success: false, error: "Staff role requires Manager approval to post responses." });
    }

    const isOwner = req.user.role === "gm" || req.user.role === "superadmin" || req.user.role === "owner" || req.user.role === "property_manager";
    const isLead = req.user.role === "dept_head" || req.user.role === "lead";

    let nextStatus = "RESPONDED";
    let nextApprovalStatus = "approved";

    if (is_submission) {
      nextStatus = "PENDING APPROVAL";
      nextApprovalStatus = "submitted";
    } else if (isLead) {
      nextStatus = "LEAD APPROVED";
      nextApprovalStatus = "lead_approved";
    } else if (isOwner) {
      nextStatus = "RESPONDED";
      nextApprovalStatus = "approved";
    }

    console.log("APPROVE REQUEST - Review ID:", review_id, "Hotel ID:", req.user.hotel_id, "Is Submission:", is_submission);

    const hotelFilter = await getHotelFilter(req);
    const revToApprove = await findReviewByAnyId(review_id, hotelFilter, req.user?.role);
    if (!revToApprove) return res.status(404).json({ success: false, message: "Review not found" });
    const updatedReview = await Review.findByIdAndUpdate(
      revToApprove._id,
      {
        status: nextStatus,
        approval_status: nextApprovalStatus,
        response_text,
        response_tone,
        submitted_by: is_submission ? approved_by : undefined,
        approved_by: is_submission ? undefined : approved_by,
        approved_at: Date.now(),
        $push: {
          audit_log: {
            action: is_submission ? "submitted_for_approval" : (isLead ? "lead_approved" : "approved"),
            actor: approved_by || req.user.name || req.user.email,
            details: is_submission ? `Submitted for approval with ${response_tone} tone` : (isLead ? `Approved by Lead with ${response_tone} tone` : `Approved and published with ${response_tone} tone`),
            timestamp: Date.now()
          },
          response_history: {
            version: 1,
            text: response_text,
            tone: response_tone,
            editor: approved_by || req.user.name,
            timestamp: Date.now(),
            is_approved: isOwner
          }
        }
      },
      { new: true }
    );

    if (!updatedReview) {
      console.log("FAILED TO FIND REVIEW FOR UPDATE");
    } else {
      console.log("SUCCESSFULLY UPDATED REVIEW:", updatedReview.status);
      if (is_submission) {
        await workflowNotificationService.notifyStaffSubmittedResponse(updatedReview, req.user);
      } else if (isLead) {
        await workflowNotificationService.notifyLeadApproved(updatedReview, req.user);
      } else if (isOwner) {
        await workflowNotificationService.notifyOwnerPublished(updatedReview, req.user);
      }
    }

    res.json({ success: true, data: updatedReview });
  } catch (err) {
    next(err);
  }
};

// Old rejectResponse replaced by full workflow rejectResponse below at line 1365

exports.reopenReview = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOneAndUpdate(
      { review_id, ...hotelFilter, status: "RESPONDED" },
      {
        status: "IN REVIEW",
        approval_status: "reopened", // Send back to reopened state
        $push: {
          audit_log: {
            action: "reopened",
            actor: req.user.name || req.user.email,
            details: "Response unapproved — review reopened for new response",
            timestamp: Date.now()
          }
        }
      },
      { new: true }
    );
    if (!review) return res.status(404).json({ success: false, message: "Review not found or not in RESPONDED state" });
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.flagSuspicious = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const { suspicious_reason, flag_reason_category, flag_assigned_to, flag_assigned_to_name } = req.body;
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOneAndUpdate(
      { review_id, ...hotelFilter },
      {
        is_suspicious: true,
        status: "Suspicious",
        suspicious_reason,
        flag_reason_category: flag_reason_category || "Other",
        flagged_by: req.user.name || req.user.email,
        flagged_at: Date.now(),
        flag_assigned_to: flag_assigned_to || null,
        flag_assigned_to_name: flag_assigned_to_name || null,
        $push: {
          audit_log: {
            action: "flagged",
            actor: req.user.name || req.user.email,
            details: `Flagged as ${flag_reason_category || "Other"}: ${suspicious_reason}`,
            timestamp: Date.now()
          }
        }
      },
      { new: true }
    );

    // Sync to Ticket
    if (review && review.linked_ticket_id) {
      const hotelFilter2 = await getHotelFilter(req);
      await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, ...hotelFilter2 },
        { is_flagged: true, flag_reason: suspicious_reason }
      );
    }

    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.removeSuspiciousFlag = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOneAndUpdate(
      { review_id, ...hotelFilter },
      {
        is_suspicious: false,
        status: "Classified",
        suspicious_reason: null,
        flag_reason_category: null,
        flagged_by: null,
        flagged_at: null,
        flag_assigned_to: null,
        flag_assigned_to_name: null,
        $push: {
          audit_log: {
            action: "deflagged",
            actor: req.user.name || req.user.email,
            details: "Flag removed — review returned to Classified status",
            timestamp: Date.now()
          }
        }
      },
      { new: true }
    );

    // Sync to Ticket
    if (review && review.linked_ticket_id) {
      const hotelFilter2 = await getHotelFilter(req);
      await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, ...hotelFilter2 },
        { is_flagged: false, flag_reason: null }
      );
    }

    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.addNote = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const { text, author } = req.body;
    const review = await Review.findOneAndUpdate(
      { review_id, ...await getHotelFilter(req) },
      { $push: { internal_notes: { text, author, timestamp: Date.now() } } },
      { new: true }
    );
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.reanalyse = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const review = await Review.findOneAndUpdate(
      { review_id, ...await getHotelFilter(req) },
      {
        status: "NEW",
        sentiment: null,
        sentiment_reason: null,
        confidence: null,
        departments: [],
        primary_department: null,
        urgency: null,
        urgency_reason: null,
        issues: [],
        positive_aspects: [],
        requires_response: null,
        response_priority: null,
        suggested_action: null,
        is_factual_only: null,
        is_suspicious: null,
        suspicious_reason: null,
        guest_emotion: null,
        escalation_risk: null,
        escalation: false,
        escalation_reason: null,
        needs_human_review: null,
        human_review_reason: null,
        ai_error: null,
        classified_at: null,
        is_processed: false,
        retry_count: 0
      },
      { new: true }
    );

    // Sync to Ticket (unflag if re-analysing)
    if (review && review.linked_ticket_id) {
      await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, ...await getHotelFilter(req) },
        { is_flagged: false, flag_reason: null }
      );
    }

    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.assignStaff = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const { staff_id, staff_name } = req.body;
    const assignee_id = staff_id;
    const assignee_name = staff_name;

    const review = await Review.findOne({ review_id, ...await getHotelFilter(req) });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    review.assignee_id = assignee_id;
    review.assignee_name = assignee_name;
    review.assigned_to_staff_id = assignee_id;
    review.assigned_to_staff_name = assignee_name;
    review.assigned_at = Date.now();

    // Auto-update status to match lifecycle
    const lifecycleStatuses = ["NEW", "IN REVIEW", "RESPONDED", "CLOSED", "ESCALATED"];
    if (!lifecycleStatuses.includes(review.status) || review.status === "NEW") {
      const hotel = await Hotel.findById(review.hotel_id);
      const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);

      review.escalation = review.rating <= escalationThreshold;

      if (review.rating <= 1) {
        review.is_suspicious = true;
        review.suspicious_reason = "Auto-flagged: Rating is 1 star or below.";
        review.status = "Suspicious";
      } else if (review.rating <= escalationThreshold) {
        review.status = "ESCALATED";
      } else {
        review.status = "IN REVIEW";
      }
    }

    await review.save();
    await workflowNotificationService.notifyReviewAssigned(review, req.user);
    if (review.escalation || review.status === "ESCALATED") {
      await workflowNotificationService.notifyEscalatedReview(review);
    }

    let ticket;
    if (review.linked_ticket_id) {
      ticket = await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, ...await getHotelFilter(req) },
        { assignee_id, assignee_name, status: "In Progress" },
        { new: true }
      );
    } else {
      // Auto-create ticket
      const hotel = await Hotel.findById(review.hotel_id);
      const slaConfig = hotel?.slaConfig || { high: 4, medium: 24, low: 72 };
      const deptSla = hotel?.deptSlaConfig || {};

      const urgencyKey = (review.urgency || "Medium").toLowerCase();
      const deptName = review.primary_department;

      // Calculate SLA: Dept override takes priority, then urgency-based
      // Use case-insensitive lookup for department
      let deptHours;
      if (deptName) {
        const foundDeptKey = Object.keys(deptSla).find(k => k.toLowerCase() === deptName.toLowerCase());
        if (foundDeptKey) deptHours = deptSla[foundDeptKey];
      }

      // Also handle case-insensitivity for urgency lookup
      let urgencyHours;
      if (urgencyKey) {
        const foundUrgencyKey = Object.keys(slaConfig).find(k => k.toLowerCase() === urgencyKey.toLowerCase());
        if (foundUrgencyKey) urgencyHours = slaConfig[foundUrgencyKey];
      }

      let hours = deptHours || urgencyHours || 24;
      const deadline = Date.now() + (hours * 60 * 60 * 1000);

      ticket = new Ticket({
        ticket_id: "TKT-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5).toUpperCase(),
        hotel_id: review.hotel_id,
        review_id: review.review_id,
        guest_name: review.reviewer_name,
        review_text: review.review_text,
        department: review.primary_department,
        urgency: review.urgency || "Medium",
        status: "In Progress",
        assignee_id,
        assignee_name,
        created_at: Date.now(),
        sla_deadline: deadline,
        status_history: [{ status: "In Progress", changed_by: "Staff Assignment", timestamp: Date.now() }]
      });
      await ticket.save();

      review.linked_ticket_id = ticket.ticket_id;
      await review.save();
    }

    res.json({ success: true, data: review, ticket });
  } catch (err) {
    next(err);
  }
};

exports.deleteReview = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    await Review.findOneAndDelete({ review_id, ...await getHotelFilter(req) });
    // Also delete linked ticket if any
    await Ticket.findOneAndDelete({ review_id, ...await getHotelFilter(req) });
    res.json({ success: true, message: "Review and linked ticket deleted due to analysis failure or user request" });
  } catch (err) {
    next(err);
  }
};

exports.deleteAllReviews = async (req, res, next) => {
  try {
    const Ticket = require("../models/Ticket");
    const hotelFilter = await getHotelFilter(req);
    await Review.deleteMany(hotelFilter);
    await Ticket.deleteMany(hotelFilter);
    res.json({ success: true, message: "All reviews and tickets deleted" });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════
// NEW ENDPOINTS — Review Detail Page
// ═══════════════════════════════════════════

exports.getReviewById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const review = await findReviewByAnyId(id, hotelFilter, req.user?.role);

    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    // Fetch linked ticket if exists
    let ticket = null;
    if (review.linked_ticket_id) {
      ticket = await Ticket.findOne({ ticket_id: review.linked_ticket_id, ...hotelFilter });
      if (!ticket && req.user?.role !== "staff") {
        ticket = await Ticket.findOne({ ticket_id: review.linked_ticket_id });
      }
    }

    res.json({ success: true, data: { review, ticket } });
  } catch (err) {
    next(err);
  }
};

exports.saveDraft = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const { text, tone, model, generated_by, editor } = req.body;

    const review = await findReviewByAnyId(review_id, await getHotelFilter(req), req.user?.role);
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    const currentVersion = (review.draft_history || []).length + 1;

    review.draft_history.push({
      version: currentVersion,
      text,
      tone,
      model: model || "llama-3.3-70b-versatile",
      generated_by: generated_by || "ai",
      editor: editor || req.user.name || req.user.email,
      char_count: text.length,
      timestamp: Date.now()
    });

    review.audit_log.push({
      action: "draft_generated",
      actor: editor || req.user.name || req.user.email,
      details: `Draft v${currentVersion} generated (${tone} tone, ${generated_by || "ai"})`,
      timestamp: Date.now()
    });

    await review.save();
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.getReviewerProfile = async (req, res, next) => {
  try {
    const { reviewer_name } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const reviews = await Review.find({
      ...hotelFilter,
      reviewer_name: { $regex: new RegExp(`^${reviewer_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    }).sort({ imported_at: -1 }).select('review_id rating sentiment platform hotel_name review_text review_date imported_at status');

    if (reviews.length === 0) {
      return res.json({ success: true, data: { reviewer_name, total_reviews: 0, reviews: [] } });
    }

    const totalReviews = reviews.length;
    const avgRating = Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10;
    const platforms = [...new Set(reviews.map(r => r.platform).filter(Boolean))];
    const properties = [...new Set(reviews.map(r => r.hotel_name).filter(Boolean))];
    const firstReview = reviews[reviews.length - 1];
    const latestReview = reviews[0];

    res.json({
      success: true,
      data: {
        reviewer_name,
        total_reviews: totalReviews,
        avg_rating: avgRating,
        platforms,
        properties,
        first_review_date: firstReview?.imported_at || firstReview?.review_date,
        latest_review_date: latestReview?.imported_at || latestReview?.review_date,
        reviews
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getSimilarReviews = async (req, res, next) => {
  try {
    const { id: review_id } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOne({ review_id, ...hotelFilter });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    // Find reviews with same department + similar sentiment, excluding self
    const query = {
      ...hotelFilter,
      review_id: { $ne: review_id },
      is_processed: true
    };

    // Primary match: same department
    if (review.primary_department) {
      query.primary_department = review.primary_department;
    }

    const similar = await Review.find(query)
      .sort({ imported_at: -1 })
      .limit(5)
      .select('review_id reviewer_name rating sentiment platform hotel_name review_text primary_department urgency imported_at issues');

    // Count total reviews in this department in last 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const deptTrend = review.primary_department ? await Review.countDocuments({
      ...hotelFilter,
      primary_department: review.primary_department,
      sentiment: { $in: ["Negative", "Mixed"] },
      imported_at: { $gte: thirtyDaysAgo }
    }) : 0;

    res.json({
      success: true,
      data: {
        similar,
        trend: {
          department: review.primary_department,
          negative_count_30d: deptTrend,
          message: deptTrend > 0 ? `${review.primary_department} has ${deptTrend} negative/mixed reviews in the last 30 days` : null
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// ─── Pending Status (for TopBar badge + auto-poll) ────────────────────────────
exports.getPendingStatus = async (req, res, next) => {
  try {
    const hotel_id = req.user.hotel_id;
    const [pendingCount, totalCount] = await Promise.all([
      Review.countDocuments({ hotel_id, is_processed: { $ne: true } }),
      Review.countDocuments({ hotel_id })
    ]);
    res.json({ success: true, data: { pendingCount, totalCount } });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: REVIEW ASSIGNMENT API
// ═══════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────
// ASSIGN REVIEW TO STAFF
// ───────────────────────────────────────────────────────────────────────────
exports.assignReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assigned_to_staff_id, assigned_to_staff_name, assigned_to_role } = req.body;

    // ── VALIDATION ──────────────────────────────────────────────────────────
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Review ID is required"
      });
    }

    if (!assigned_to_staff_id || !assigned_to_staff_id.trim()) {
      return res.status(400).json({
        success: false,
        error: "Staff ID is required"
      });
    }

    if (!assigned_to_staff_name || !assigned_to_staff_name.trim()) {
      return res.status(400).json({
        success: false,
        error: "Staff name is required"
      });
    }

    if (!assigned_to_role || !["staff", "lead", "owner"].includes(assigned_to_role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid staff role"
      });
    }

    // ── FETCH REVIEW ────────────────────────────────────────────────────────
    const review = await findReviewByAnyId(id, await getHotelFilter(req), req.user?.role);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // ── AUTHORIZATION ──────────────────────────────────────────────────────
    if (req.user.role !== "superadmin" && req.user.role !== "owner" && req.user.role !== "lead") {
      return res.status(403).json({
        success: false,
        error: "Only owners, leads, and admins can assign reviews"
      });
    }

    // ── VERIFY STAFF EXISTS ─────────────────────────────────────────────────
    const staff = await Staff.findById(assigned_to_staff_id);
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: `Staff member "${assigned_to_staff_name}" not found`
      });
    }

    if (!staff.is_active) {
      return res.status(400).json({
        success: false,
        error: `Staff member "${assigned_to_staff_name}" is inactive`
      });
    }

    // ── ASSIGN REVIEW ───────────────────────────────────────────────────────
    review.assigned_to_staff_id = assigned_to_staff_id;
    review.assigned_to_staff_name = assigned_to_staff_name;
    review.assigned_to_role = assigned_to_role;
    review.assigned_by_id = req.user._id;
    review.assigned_by_name = req.user.name || req.user.email;
    review.assigned_by_role = req.user.role;
    review.assigned_at = Date.now();
    review.approval_status = "pending";

    // ── ADD AUDIT LOG ───────────────────────────────────────────────────────
    if (!review.audit_log) review.audit_log = [];
    review.audit_log.push({
      action: "assigned",
      actor: req.user.name || req.user.email,
      details: `Assigned to ${assigned_to_staff_name} (${assigned_to_role})`,
      timestamp: Date.now()
    });

    await review.save();
    await workflowNotificationService.notifyReviewAssigned(review, req.user);
    if (review.escalation || review.status === "ESCALATED") {
      await workflowNotificationService.notifyEscalatedReview(review);
    }

    // ── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: `Review assigned to ${assigned_to_staff_name}`,
      review: {
        id: review._id,
        review_id: review.review_id,
        assigned_to_staff_name: review.assigned_to_staff_name,
        assigned_to_role: review.assigned_to_role,
        assigned_at: review.assigned_at
      }
    });
  } catch (err) {
    console.error("Assign review error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to assign review"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// UNASSIGN REVIEW
// ───────────────────────────────────────────────────────────────────────────
exports.unassignReview = async (req, res, next) => {
  try {
    const { id } = req.params;

    // ── VALIDATION ──────────────────────────────────────────────────────────
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Review ID is required"
      });
    }

    // ── FETCH REVIEW ────────────────────────────────────────────────────────
    const review = await findReviewByAnyId(id, await getHotelFilter(req), req.user?.role);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // ── AUTHORIZATION ──────────────────────────────────────────────────────
    if (req.user.role !== "superadmin" && req.user.role !== "owner" && req.user.role !== "lead") {
      return res.status(403).json({
        success: false,
        error: "Only owners, leads, and admins can unassign reviews"
      });
    }

    const oldAssignee = review.assigned_to_staff_name || "Unassigned";

    // ── UNASSIGN ────────────────────────────────────────────────────────────
    review.assigned_to_staff_id = null;
    review.assigned_to_staff_name = "Unassigned";
    review.assigned_to_role = null;
    review.assigned_by_id = null;
    review.assigned_by_name = null;
    review.assigned_by_role = null;
    review.assigned_at = null;

    // ── ADD AUDIT LOG ───────────────────────────────────────────────────────
    if (!review.audit_log) review.audit_log = [];
    review.audit_log.push({
      action: "unassigned",
      actor: req.user.name || req.user.email,
      details: `Unassigned from ${oldAssignee}`,
      timestamp: Date.now()
    });

    await review.save();

    // ── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: `Review unassigned from ${oldAssignee}`
    });
  } catch (err) {
    console.error("Unassign review error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to unassign review"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// GET MY REVIEW QUEUE (Staff only sees their assigned reviews)
// ───────────────────────────────────────────────────────────────────────────
exports.getMyQueue = async (req, res, next) => {
  try {
    // ── AUTHORIZATION ──────────────────────────────────────────────────────
    if (req.user.role !== "staff" && req.user.role !== "lead" && req.user.role !== "owner") {
      return res.status(403).json({
        success: false,
        error: "Only staff, leads, and owners can view queues"
      });
    }

    // ── BUILD FILTER ────────────────────────────────────────────────────────
    let filter = {};

    if (req.user.role === "staff") {
      // Staff sees only reviews assigned to them
      const userId = (req.user._id || req.user.id).toString();
      filter.$or = [
        { assigned_to_staff_id: userId },
        { assignee_id: userId }
      ];
    } else if (req.user.role === "lead") {
      // Lead sees reviews assigned to their team
      const userId = (req.user._id || req.user.id);
      const staff = await Staff.find({
        business_id: req.user.business_id,
        reporting_to: userId,
        is_active: true
      }).select("_id");

      const staffIds = staff.map(s => s._id.toString());
      staffIds.push(userId.toString()); // Include themselves

      filter.$or = [
        { assigned_to_staff_id: { $in: staffIds } },
        { assignee_id: { $in: staffIds } }
      ];
    } else if (req.user.role === "owner") {
      // Owner sees all unresponded reviews for their business
      const hotelFilter = await getHotelFilter(req);
      filter = { ...hotelFilter };
    }

    // ── FETCH REVIEWS ───────────────────────────────────────────────────────
    const reviews = await Review.find(filter)
      .select(
        "review_id reviewer_name rating review_text review_date platform assigned_to_staff_name assigned_to_staff_id assignee_id assignee_name " +
        "approval_status response_text submitted_by assigned_at primary_department urgency sentiment draft_history"
      )
      .sort({ assigned_at: -1, urgency: -1 });

    console.log('[getMyQueue] User:', req.user.email || req.user.name || req.user.id);
    console.log('[getMyQueue] Role:', req.user.role);
    console.log('[getMyQueue] Filter:', JSON.stringify(filter));
    console.log('[getMyQueue] Found reviews:', reviews.length);

    if (!reviews || reviews.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No reviews in queue",
        reviews: [],
        total: 0
      });
    }

    // ── COUNT BY STATUS ─────────────────────────────────────────────────────
    const stats = {
      total: reviews.length,
      pending_response: reviews.filter(r => !r.response_text || r.approval_status === "pending").length,
      submitted_for_approval: reviews.filter(r => r.approval_status === "submitted").length,
      approved: reviews.filter(r => r.approval_status === "approved").length
    };

    // ── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      stats,
      reviews: reviews.map(r => ({
        id: r._id,
        review_id: r.review_id,
        reviewer_name: r.reviewer_name,
        rating: r.rating,
        review_text: r.review_text,
        review_date: r.review_date,
        platform: r.platform,
        assigned_to: r.assigned_to_staff_name || r.assignee_name,
        assigned_to_staff_id: r.assigned_to_staff_id || r.assignee_id,
        assignee_id: r.assignee_id || r.assigned_to_staff_id,
        primary_department: r.primary_department,
        urgency: r.urgency,
        sentiment: r.sentiment,
        approval_status: r.approval_status,
        response_text: r.response_text,
        draft_history: r.draft_history,
        has_response: !!r.response_text,
        submitted_by: r.submitted_by,
        assigned_at: r.assigned_at
      }))
    });
  } catch (err) {
    console.error("Get my queue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch review queue"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// SUBMIT RESPONSE FOR APPROVAL
// ───────────────────────────────────────────────────────────────────────────
exports.submitResponse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { response_text, response_tone } = req.body;

    // ── VALIDATION ──────────────────────────────────────────────────────────
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Review ID is required"
      });
    }

    if (!response_text || !response_text.trim()) {
      return res.status(400).json({
        success: false,
        error: "Response text is required"
      });
    }

    if (response_text.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: "Response must be at least 10 characters"
      });
    }

    if (response_text.trim().length > 5000) {
      return res.status(400).json({
        success: false,
        error: "Response cannot exceed 5000 characters"
      });
    }

    if (!response_tone || !["professional", "apologetic", "friendly", "neutral"].includes(response_tone)) {
      return res.status(400).json({
        success: false,
        error: "Invalid response tone. Must be professional, apologetic, friendly, or neutral"
      });
    }

    // ── FETCH REVIEW ────────────────────────────────────────────────────────
    const review = await findReviewByAnyId(id, await getHotelFilter(req), req.user?.role);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // ── AUTHORIZATION ──────────────────────────────────────────────────────
    // Staff can only submit for their own reviews
    if (req.user.role === "staff") {
      if (review.assigned_to_staff_id !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only submit responses for reviews assigned to you"
        });
      }
    } else if (req.user.role !== "superadmin" && req.user.role !== "owner" && req.user.role !== "lead") {
      return res.status(403).json({
        success: false,
        error: "Only staff, leads, and owners can submit responses"
      });
    }

    // ── SUBMIT RESPONSE ─────────────────────────────────────────────────────
    review.response_text = response_text.trim();
    review.response_tone = response_tone;
    review.submitted_by = req.user.name || req.user.email;
    review.approval_status = "submitted";

    // ── RESPONSE HISTORY ────────────────────────────────────────────────────
    if (!review.response_history) review.response_history = [];
    review.response_history.push({
      version: review.response_history.length + 1,
      text: response_text.trim(),
      tone: response_tone,
      editor: req.user.name || req.user.email,
      timestamp: Date.now(),
      is_approved: false
    });

    // ── ADD AUDIT LOG ───────────────────────────────────────────────────────
    if (!review.audit_log) review.audit_log = [];
    review.audit_log.push({
      action: "submitted",
      actor: req.user.name || req.user.email,
      details: `Submitted response with ${response_tone} tone`,
      timestamp: Date.now()
    });

    await review.save();
    await workflowNotificationService.notifyStaffSubmittedResponse(review, req.user);

    // ── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: "Response submitted for approval",
      submission: {
        id: review._id,
        review_id: review.review_id,
        approval_status: review.approval_status,
        submitted_by: review.submitted_by,
        submitted_at: Date.now()
      }
    });
  } catch (err) {
    console.error("Submit response error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to submit response"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// GET PENDING APPROVALS (For Leads/Owners)
// ───────────────────────────────────────────────────────────────────────────
exports.getPendingApprovals = async (req, res, next) => {
  try {
    // ── AUTHORIZATION ──────────────────────────────────────────────────────
    if (req.user.role !== "superadmin" && req.user.role !== "owner" && req.user.role !== "lead") {
      return res.status(403).json({
        success: false,
        error: "Only leads and owners can view pending approvals"
      });
    }

    // ── BUILD FILTER ────────────────────────────────────────────────────────
    let filter = { approval_status: "submitted" };

    if (req.user.role === "lead") {
      // Lead sees responses from their team only
      const staff = await Staff.find({
        reporting_to: req.user._id,
        is_active: true
      }).select("_id");

      const staffIds = staff.map(s => s._id.toString());
      filter.assigned_to_staff_id = { $in: staffIds };
    }

    // ── FETCH REVIEWS ───────────────────────────────────────────────────────
    const reviews = await Review.find(filter)
      .select(
        "review_id reviewer_name rating review_text platform response_text response_tone " +
        "submitted_by assigned_to_staff_name primary_department sentiment"
      )
      .sort({ assigned_at: -1 });

    if (!reviews || reviews.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No responses pending approval",
        reviews: [],
        total: 0
      });
    }

    // ── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      total: reviews.length,
      reviews: reviews.map(r => ({
        id: r._id,
        review_id: r.review_id,
        reviewer_name: r.reviewer_name,
        rating: r.rating,
        review_text: r.review_text,
        platform: r.platform,
        submitted_by: r.submitted_by,
        assigned_to: r.assigned_to_staff_name,
        primary_department: r.primary_department,
        sentiment: r.sentiment,
        response_text: r.response_text,
        response_tone: r.response_tone
      }))
    });
  } catch (err) {
    console.error("Get pending approvals error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch pending approvals"
    });
  }
};

// ───────────────────────────────────────────────────────────────────────────
// REJECT RESPONSE
// ───────────────────────────────────────────────────────────────────────────
exports.rejectResponse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    // ── VALIDATION ──────────────────────────────────────────────────────────
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Review ID is required"
      });
    }

    if (!rejection_reason || !rejection_reason.trim()) {
      const rev = await findReviewByAnyId(id, await getHotelFilter(req), req.user?.role);
      if (rev && rev.approval_status !== "submitted") {
        // Event 4: LEAD REJECTS REVIEW (outright rejection without response)
        rev.status = "REJECTED";
        rev.approval_status = "rejected";
        rev.rejection_by = req.user.name || req.user.email;
        rev.rejection_at = Date.now();
        await rev.save();
        await workflowNotificationService.notifyReviewRejected(rev, req.user);
        return res.status(200).json({
          success: true,
          message: "Review rejected and removed from workflow",
          rejection: {
            id: rev._id,
            review_id: rev.review_id,
            approval_status: rev.approval_status
          }
        });
      }
      return res.status(400).json({
        success: false,
        error: "Rejection reason is required"
      });
    }

    // ── FETCH REVIEW ────────────────────────────────────────────────────────
    const review = await findReviewByAnyId(id, await getHotelFilter(req), req.user?.role);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    // ── AUTHORIZATION ──────────────────────────────────────────────────────
    if (req.user.role !== "superadmin" && req.user.role !== "owner" && req.user.role !== "lead") {
      return res.status(403).json({
        success: false,
        error: "Only leads and owners can reject responses"
      });
    }

    // ── VERIFY RESPONSE EXISTS ──────────────────────────────────────────────
    if (!review.response_text) {
      return res.status(400).json({
        success: false,
        error: "No response to reject"
      });
    }

    if (review.approval_status === "approved") {
      return res.status(400).json({
        success: false,
        error: "Cannot reject an already approved response"
      });
    }

    // ── REJECT RESPONSE ─────────────────────────────────────────────────────
    review.approval_status = "rejected";
    review.rejection_reason = rejection_reason.trim();
    review.rejection_by = req.user.name || req.user.email;
    review.rejection_at = Date.now();

    // ── ADD AUDIT LOG ───────────────────────────────────────────────────────
    if (!review.audit_log) review.audit_log = [];
    review.audit_log.push({
      action: "rejected",
      actor: req.user.name || req.user.email,
      details: `Response rejected: ${rejection_reason.trim()}`,
      timestamp: Date.now()
    });

    await review.save();
    if (["owner", "gm", "property_manager", "superadmin"].includes(req.user.role)) {
      await workflowNotificationService.notifyOwnerRejectedToLead(review, req.user, rejection_reason);
    } else {
      await workflowNotificationService.notifyLeadRequestedChanges(review, req.user, rejection_reason);
    }

    // ── RETURN RESPONSE ─────────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: "Response rejected and sent back to staff",
      rejection: {
        id: review._id,
        review_id: review.review_id,
        approval_status: review.approval_status,
        rejection_reason: review.rejection_reason,
        rejected_at: review.rejection_at
      }
    });
  } catch (err) {
    console.error("Reject response error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to reject response"
    });
  }
};
