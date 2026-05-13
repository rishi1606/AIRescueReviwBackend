const Review = require("../models/Review");
const Ticket = require("../models/Ticket");
const mongoose = require("mongoose");

exports.getStats = async (req, res, next) => {
  try {
    const hotel_id = req.user.hotel_id;

    const [
      totalReviews,
      avgRatingAgg,
      criticalIssues,
      escalationRisk,
      mixed,
      neutral,
      resolved,
      approved,
      flagged
    ] = await Promise.all([
      Review.countDocuments({ hotel_id }),
      Review.aggregate([
        { $match: { hotel_id: new mongoose.Types.ObjectId(hotel_id) } },
        { $group: { _id: null, avg: { $avg: "$rating" } } }
      ]),
      Review.countDocuments({ hotel_id, urgency: "High" }),
      Review.countDocuments({ hotel_id, escalation_risk: true }),
      Review.countDocuments({ hotel_id, sentiment: "Mixed" }),
      Review.countDocuments({ hotel_id, sentiment: "Neutral" }),
      Ticket.countDocuments({ hotel_id, status: "Resolved" }),
      Review.countDocuments({ hotel_id, status: "Approved" }),
      Review.countDocuments({ hotel_id, is_suspicious: true })
    ]);

    res.json({
      success: true,
      data: {
        totalReviews,
        avgRating: avgRatingAgg[0]?.avg || 0,
        criticalIssues,
        escalationRisk,
        mixed,
        neutral,
        resolved,
        approved,
        flagged
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getSentimentTrend = async (req, res, next) => {
  try {
    const hotel_id = req.user.hotel_id;
    const { range = 7 } = req.query;
    const days = parseInt(range);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const trend = await Review.aggregate([
      { 
        $match: { 
          hotel_id: new mongoose.Types.ObjectId(hotel_id),
          review_date: { $gte: startDate.toISOString() }
        } 
      },
      {
        $group: {
          _id: { $substr: ["$review_date", 0, 10] },
          positive: { $sum: { $cond: [{ $eq: ["$sentiment", "Positive"] }, 1, 0] } },
          negative: { $sum: { $cond: [{ $eq: ["$sentiment", "Negative"] }, 1, 0] } },
          mixed: { $sum: { $cond: [{ $eq: ["$sentiment", "Mixed"] }, 1, 0] } },
          neutral: { $sum: { $cond: [{ $eq: ["$sentiment", "Neutral"] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({ success: true, data: trend });
  } catch (err) {
    next(err);
  }
};

exports.getRecentReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ hotel_id: req.user.hotel_id })
      .sort({ createdAt: -1 })
      .limit(5);
    res.json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
};
