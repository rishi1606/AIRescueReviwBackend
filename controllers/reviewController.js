const Review = require("../models/Review");
const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Ticket = require("../models/Ticket");

exports.getReviews = async (req, res, next) => {
  try {
    const { sentiment, department, urgency, status, platform, property, rating, dateStart, dateEnd, search, page, limit, minConfidence, sortBy } = req.query;
    let query = { hotel_id: req.user.hotel_id };

    if (sentiment && sentiment !== "ALL") query.sentiment = sentiment;

    // Scoping for standard staff and department heads
    if (req.user.role === "staff" || req.user.role === "dept_head") {
      let userDept = req.user.department;
      if (!userDept) {
        const staff = await Staff.findById(req.user.id);
        if (staff) userDept = staff.department;
      }
      if (userDept) {
        query.primary_department = userDept;
      }
    } else {
      if (department && department !== "ALL") query.primary_department = department;
    }
    if (urgency && urgency !== "ALL") query.urgency = urgency;
    if (status && status !== "ALL") {
      if (status.includes(",")) {
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
      query.createdAt = {};
      if (dateStart) query.createdAt.$gte = new Date(dateStart);
      if (dateEnd) {
        const endDate = new Date(dateEnd);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    if (search) {
      query.$or = [
        { reviewer_name: { $regex: search, $options: "i" } },
        { review_text: { $regex: search, $options: "i" } }
      ];
    }

    const hotel = await Hotel.findById(req.user.hotel_id);
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
    const hotel = await Hotel.findById(req.user.hotel_id);
    const extraction = req.body; // AI extracted sentiment, issues, department

    // Step 2 — Backend Logic Implementation
    const review = await Review.findOne({ review_id, hotel_id: req.user.hotel_id });
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

    // 3. Calculate Confidence (deterministic backend logic)
    const confidence = extraction.primary_department && extraction.sentiment ? 95 : 70;

    // 4. Validate & Store
    const classificationPayload = {
      ...extraction,
      urgency,
      confidence,
      status,
      escalation,
      is_suspicious,
      suspicious_reason,
      needs_human_review: confidence < (hotel?.aiConfig?.confidenceThreshold || 75),
      classified_at: Date.now()
    };

    const updatedReview = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
      { ...classificationPayload },
      { new: true }
    );

    res.json({ success: true, data: updatedReview });
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
        escalation: false,
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

exports.deleteReview = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    await Review.findOneAndDelete({ review_id, hotel_id: req.user.hotel_id });
    // Also delete linked ticket if any
    await Ticket.findOneAndDelete({ review_id, hotel_id: req.user.hotel_id });
    res.json({ success: true, message: "Review and linked ticket deleted due to analysis failure or user request" });
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
