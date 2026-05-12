const Review = require("../models/Review");
const Hotel = require("../models/Hotel");

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
          status: "Pending AI",
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
    let status = "Classified";
    if (classification.is_suspicious) status = "Suspicious";
    else if (classification.is_factual_only) status = "No Action";

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
    const { response_text, response_tone, approved_by } = req.body;
    
    const updatedReview = await Review.findOneAndUpdate(
      { review_id, hotel_id: req.user.hotel_id },
      { 
        status: "Approved",
        response_text,
        response_tone,
        approved_by,
        approved_at: Date.now()
      },
      { new: true }
    );

    res.json({ success: true, data: updatedReview });
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
        status: "Pending AI",
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
    res.json({ success: true, data: review });
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
