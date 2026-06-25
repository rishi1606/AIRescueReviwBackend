const Review = require("../models/Review");
const Ticket = require("../models/Ticket");
const Staff = require("../models/Staff");
const mongoose = require("mongoose");

// Helper function to extract user department for scoping
async function getUserDepartment(req) {
  if (req.user.role === "staff" || req.user.role === "dept_head") {
    let userDept = req.user.department;
    if (!userDept) {
      const staff = await Staff.findById(req.user.id);
      if (staff) userDept = staff.department;
    }
    return userDept;
  }
  return null;
}

exports.getStats = async (req, res, next) => {
  try {
    // For Business Owner, use business_id; otherwise use hotel_id
    let hotel_id = req.user.hotel_id;
    console.log('[getStats] User role:', req.user.role, 'Initial hotel_id:', hotel_id);

    if (req.user.role === 'owner' || req.user.role === 'property_manager') {
      const staff = await Staff.findById(req.user.id);
      console.log('[getStats] Staff found:', !!staff, 'business_id:', staff?.business_id);
      if (staff?.business_id) {
        hotel_id = staff.business_id;
      }
    }
    console.log('[getStats] Final hotel_id:', hotel_id);

    const userDept = await getUserDepartment(req);
    console.log('[getStats] userDept:', userDept, 'req.user.department:', req.user.department);

    // Build the query matches
    let reviewQuery = { hotel_id };
    let ticketQuery = { hotel_id };
    let ratingMatch = { hotel_id: new mongoose.Types.ObjectId(hotel_id) };
    console.log('[getStats] reviewQuery before dept:', reviewQuery);

    if (userDept) {
      reviewQuery.primary_department = userDept;
      ticketQuery.department = userDept;
      ratingMatch.primary_department = userDept;
      console.log('[getStats] Added department filter:', userDept);
    }
    console.log('[getStats] reviewQuery after dept:', reviewQuery);

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
      Review.countDocuments(reviewQuery),
      Review.aggregate([
        { $match: ratingMatch },
        { $group: { _id: null, avg: { $avg: "$rating" } } }
      ]),
      Review.countDocuments({ ...reviewQuery, urgency: "High" }),
      Review.countDocuments({ ...reviewQuery, escalation_risk: true }),
      Review.countDocuments({ ...reviewQuery, sentiment: "Mixed" }),
      Review.countDocuments({ ...reviewQuery, sentiment: "Neutral" }),
      Ticket.countDocuments({ ...ticketQuery, status: "Resolved" }),
      Review.countDocuments({ ...reviewQuery, status: "Approved" }),
      Review.countDocuments({ ...reviewQuery, is_suspicious: true })
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
    // For Business Owner, use business_id; otherwise use hotel_id
    let hotel_id = req.user.hotel_id;
    if (req.user.role === 'owner' || req.user.role === 'property_manager') {
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        hotel_id = staff.business_id;
      }
    }

    const { range = 7 } = req.query;
    const days = parseInt(range);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const userDept = await getUserDepartment(req);
    let matchStage = { 
      hotel_id: new mongoose.Types.ObjectId(hotel_id),
      review_date: { $gte: startDate.toISOString() }
    };

    if (userDept) {
      matchStage.primary_department = userDept;
    }

    const trend = await Review.aggregate([
      { $match: matchStage },
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
    // For Business Owner, use business_id; otherwise use hotel_id
    let hotel_id = req.user.hotel_id;
    if (req.user.role === 'owner' || req.user.role === 'property_manager') {
      const staff = await Staff.findById(req.user.id);
      if (staff?.business_id) {
        hotel_id = staff.business_id;
      }
    }

    const userDept = await getUserDepartment(req);

    let query = { hotel_id };
    if (userDept) {
      query.primary_department = userDept;
    }

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .limit(5);
    res.json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
};
