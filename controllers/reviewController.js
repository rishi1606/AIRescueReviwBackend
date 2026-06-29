const Review = require("../models/Review");
const Hotel = require("../models/Hotel");
const Staff = require("../models/Staff");
const Ticket = require("../models/Ticket");

// Helper: Build hotel filter (superadmin sees all, others see only their hotel)
const getHotelFilter = async (req) => {
  if (req.user.role === "superadmin") return {};

  // For Business Owner, Property Manager, and Staff, use business_id; otherwise use hotel_id
  let hotel_id = req.user.hotel_id;
  if (req.user.role === 'owner' || req.user.role === 'property_manager' || req.user.role === 'staff') {
    const staff = await Staff.findById(req.user.id);
    if (staff?.business_id) {
      hotel_id = staff.business_id;
    }
  }

  return { hotel_id };
};

exports.getReviews = async (req, res, next) => {
  console.log('🔷 [getReviews] CALLED! User:', req.user?.email, 'Role:', req.user?.role);
  try {
    const { sentiment, department, urgency, status, platform, property, rating, dateStart, dateEnd, search, page, limit, minConfidence, sortBy } = req.query;
    let query = await getHotelFilter(req);
    console.log('[getReviews] User role:', req.user.role, 'User dept:', req.user.department);

    if (sentiment && sentiment !== "ALL") query.sentiment = sentiment;

    // Scoping for standard staff and department heads
    if (req.user.role === "staff" || req.user.role === "dept_head") {
      let userDept = req.user.department;
      if (!userDept) {
        const staff = await Staff.findById(req.user.id);
        if (staff) userDept = staff.department;
      }
      console.log('[getReviews] Staff department resolved:', userDept);
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

    const hotelFilter = await getHotelFilter(req);
    const updatedReview = await Review.findOneAndUpdate(
      { review_id, ...hotelFilter },
      {
        status: is_submission ? "PENDING APPROVAL" : "RESPONDED",
        response_text,
        response_tone,
        submitted_by: is_submission ? approved_by : undefined,
        approved_by: is_submission ? undefined : approved_by,
        approved_at: Date.now(),
        $push: {
          audit_log: {
            action: is_submission ? "submitted_for_approval" : "approved",
            actor: approved_by || req.user.name || req.user.email,
            details: is_submission ? `Submitted for approval with ${response_tone} tone` : `Approved and published with ${response_tone} tone`,
            timestamp: Date.now()
          },
          response_history: {
            version: 1,
            text: response_text,
            tone: response_tone,
            editor: approved_by || req.user.name,
            timestamp: Date.now(),
            is_approved: !is_submission
          }
        }
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
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOneAndUpdate(
      { review_id, ...hotelFilter },
      { status: "IN REVIEW" },
      { new: true }
    );
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
};

exports.reopenReview = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOneAndUpdate(
      { review_id, ...hotelFilter, status: "RESPONDED" },
      {
        status: "IN REVIEW",
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
    const { review_id } = req.params;
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
    const { review_id } = req.params;
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
    const { review_id } = req.params;
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
    const { review_id } = req.params;
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
    const { review_id } = req.params;
    const { staff_id, staff_name } = req.body;
    const assignee_id = staff_id;
    const assignee_name = staff_name;

    const review = await Review.findOne({ review_id, ...await getHotelFilter(req) });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    review.assignee_id = assignee_id;
    review.assignee_name = assignee_name;

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

    let ticket;
    if (review.linked_ticket_id) {
      ticket = await Ticket.findOneAndUpdate(
        { ticket_id: review.linked_ticket_id, ...await getHotelFilter(req) },
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
    const { review_id } = req.params;
    const hotelFilter = await getHotelFilter(req);
    const review = await Review.findOne({ review_id, ...hotelFilter });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });

    // Fetch linked ticket if exists
    let ticket = null;
    if (review.linked_ticket_id) {
      ticket = await Ticket.findOne({ ticket_id: review.linked_ticket_id, ...hotelFilter });
    }

    res.json({ success: true, data: { review, ticket } });
  } catch (err) {
    next(err);
  }
};

exports.saveDraft = async (req, res, next) => {
  try {
    const { review_id } = req.params;
    const { text, tone, model, generated_by, editor } = req.body;

    const review = await Review.findOne({ review_id, ...await getHotelFilter(req) });
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
    const { review_id } = req.params;
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
