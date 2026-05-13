const Review = require("../models/Review");
const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Ticket = require("../models/Ticket");

exports.getReviews = async (req, res, next) => {
  try {
    const { sentiment, department, urgency, status, platform, rating, dateStart, dateEnd, search } = req.query;
    let query = { hotel_id: req.user.hotel_id };

    if (sentiment && sentiment !== "ALL") query.sentiment = sentiment;
    if (department && department !== "ALL") query.primary_department = department;
    if (urgency && urgency !== "ALL") query.urgency = urgency;
    if (status && status !== "ALL") query.status = status;
    if (platform && platform !== "ALL") query.platform = platform;
    if (rating && rating !== "ALL") query.rating = parseInt(rating);
    
    if (dateStart || dateEnd) {
      query.review_date = {};
      if (dateStart) query.review_date.$gte = dateStart;
      if (dateEnd) query.review_date.$lte = dateEnd;
    }

    if (search) {
      query.$or = [
        { reviewer_name: { $regex: search, $options: "i" } },
        { review_text: { $regex: search, $options: "i" } }
      ];
    }

    // Fetch Hotel Config for auto-escalation rules
    const hotel = await Hotel.findById(req.user.hotel_id);
    const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);

    const reviews = await Review.find(query).sort({ imported_at: -1 });

    res.json({ success: true, data: { reviews, total: reviews.length } });
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
        const existing = await Review.findOne({ 
          hotel_id: req.user.hotel_id,
          $or: [
            { review_id: r.review_id },
            { platform_review_id: r.platform_review_id }
          ]
        });

        if (existing) {
          skipped++;
          continue;
        }

        const newReview = new Review({
          ...r,
          hotel_id: req.user.hotel_id,
          status: "NEW",
          imported_at: Date.now()
        });
        await newReview.save();
        imported++;
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
    const { review_id } = req.params;
    const hotel = await Hotel.findOne({ hotel_id: req.user.hotel_id });
    const threshold = hotel?.ai_confidence_threshold || 75;

    const classification = req.body;
    let status = "IN REVIEW";
    
    // Check auto-escalation rule from hotel config
    const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);
    const reviewForRating = await Review.findOne({ review_id, hotel_id: req.user.hotel_id });
    
    // Status is ESCALATED ONLY if rating is low enough
    if (reviewForRating?.rating <= escalationThreshold) {
      status = "ESCALATED";
    }

    if (reviewForRating?.rating <= 1) {
      classification.is_suspicious = true;
      classification.suspicious_reason = "Auto-flagged: Rating is 1 star or below.";
      status = "ESCALATED";
    }

    if (classification.is_suspicious) status = "ESCALATED"; // Suspicious reviews are also escalations
    else if (classification.is_factual_only) status = "CLOSED"; // Factual only need no action

    const needs_human_review = classification.confidence < threshold;

    const review = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
      { 
        ...classification, 
        status, 
        needs_human_review,
        classified_at: Date.now() 
      },
      { new: true }
    );
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.approveResponse = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    const { response_text, response_tone, approved_by, is_submission } = req.body;
    
    // RBAC: Only GM/Dept Head can approve directly. Staff MUST use is_submission=true.
    const isApprover = req.user.role === "gm" || req.user.role === "dept_head" || req.user.role === "superadmin";
    if (!isApprover && !is_submission) {
      return res.status(403).json({ success: false, error: "Staff role requires Manager approval to post responses." });
    }

    console.log("APPROVE REQUEST - Review ID:", review_id, "Hotel ID:", req.user.hotel_id, "Is Submission:", is_submission);

    const updatedReview = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
      { 
        status: is_submission ? "PENDING APPROVAL" : "RESPONDED",
        response_text,
        response_tone,
        submitted_by: is_submission ? approved_by : undefined,
        approved_by: is_submission ? undefined : approved_by,
        approved_at: Date.now()
      },
      { new: true }
    );

    if (!updatedReview) {
      console.log("FAILED TO FIND REVIEW FOR UPDATE");
    } else {
      console.log("SUCCESSFULLY UPDATED REVIEW:", updatedReview.status);
    }

    res.json({ success: true, data: updatedReview });
  } catch (err) {
    next(err);
  }
};

exports.rejectResponse = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    const review = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
      { status: "IN REVIEW" },
      { new: true }
    );
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.flagSuspicious = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    const { suspicious_reason } = req.body;
    const review = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
      { is_suspicious: true, status: "Suspicious", suspicious_reason },
      { new: true }
    );

    // Sync to Ticket
    if (review && review.linked_ticket_id) {
      await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, hotel_id: req.user.hotel_id },
        { is_flagged: true, flag_reason: suspicious_reason }
      );
    }

    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.addNote = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    const { text, author } = req.body;
    const review = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
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
    const { review_id } = req.params;
    const review = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
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
        escalation_reason: null,
        needs_human_review: null,
        classified_at: null
      },
      { new: true }
    );

    // Sync to Ticket (unflag if re-analysing)
    if (review && review.linked_ticket_id) {
      await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, hotel_id: req.user.hotel_id },
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
    const { review_id } = req.params;
    const { staff_id, staff_name } = req.body;
    const assignee_id = staff_id;
    const assignee_name = staff_name;

    const review = await Review.findOne({ review_id, hotel_id: req.user.hotel_id });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    review.assignee_id = assignee_id;
    review.assignee_name = assignee_name;
    
    // Auto-update status to match lifecycle
    const lifecycleStatuses = ["NEW", "IN REVIEW", "RESPONDED", "CLOSED", "ESCALATED"];
    if (!lifecycleStatuses.includes(review.status) || review.status === "NEW") {
      const hotel = await Hotel.findOne({ hotel_id: req.user.hotel_id });
      const escalationThreshold = parseInt(hotel?.aiConfig?.escalationRatingThreshold || 1);
      
      if (review.rating <= escalationThreshold) {
        review.status = "ESCALATED";
      } else {
        review.status = "IN REVIEW";
      }

      if (review.rating <= 1) {
        review.is_suspicious = true;
        review.suspicious_reason = "Auto-flagged: Rating is 1 star or below.";
        review.status = "ESCALATED";
      }
    }
    
    await review.save();

    let ticket;
    if (review.linked_ticket_id) {
      ticket = await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, hotel_id: req.user.hotel_id },
        { assignee_id, assignee_name, status: "In Progress" },
        { new: true }
      );
    } else {
      // Auto-create ticket
      const hotel = await Hotel.findById(req.user.hotel_id);
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
        hotel_id: req.user.hotel_id,
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

exports.deleteAllReviews = async (req, res, next) => {
  try {
    const Ticket = require("../models/Ticket");
    await Review.deleteMany({ hotel_id: req.user.hotel_id });
    await Ticket.deleteMany({ hotel_id: req.user.hotel_id });
    res.json({ success: true, message: "All reviews and tickets deleted" });
  } catch (err) {
    next(err);
  }
};
