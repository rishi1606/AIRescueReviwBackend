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

// Helper function to resolve hotel_id reliably across all roles
async function getHotelId(req) {
  const staff = await Staff.findById(req.user.id);
  return staff?.business_id || staff?.hotelId || req.user?.business_id || req.user?.hotel_id;
}

exports.getStats = async (req, res, next) => {
  try {
    const hotel_id = await getHotelId(req);
    console.log('[getStats] User role:', req.user.role, 'Final hotel_id:', hotel_id);

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
      pendingTickets,
      reviewsWithResponse,
      previousPeriodReviews,
      staffCount,
      activeColleagues,
      responseRateAgg,
      avgResponseTimeAgg,
      ratingDistAgg,
      deptBreakdownAgg,
      sentimentBreakdownAgg,
      platformBreakdownAgg
    ] = await Promise.all([
      Review.countDocuments(reviewQuery),
      Review.aggregate([{ $match: ratingMatch }, { $group: { _id: null, avg: { $avg: "$rating" } } }]),
      Review.countDocuments({ ...reviewQuery, status: "Critical" }),
      Review.countDocuments({ ...reviewQuery, escalation_risk: true }),
      Ticket.countDocuments({ ...ticketQuery, status: { $in: ["Open", "In Progress"] } }),
      Review.countDocuments({ ...reviewQuery, response_status: "Responded" }),
      Review.countDocuments({ ...reviewQuery, createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
      Staff.countDocuments({ hotelId: hotel_id }),
      Staff.countDocuments({ hotelId: hotel_id, status: "active" }),
      Review.aggregate([{ $match: reviewQuery }, { $group: { _id: null, total: { $sum: 1 }, responded: { $sum: { $cond: [{ $ne: ["$response_text", null] }, 1, 0] } } } }]),
      Review.aggregate([{ $match: { ...reviewQuery, response_date: { $exists: true, $ne: null } } }, { $project: { diffHours: { $divide: [{ $subtract: ["$response_date", "$createdAt"] }, 3600000] } } }, { $group: { _id: null, avgHours: { $avg: "$diffHours" } } }]),
      Review.aggregate([{ $match: ratingMatch }, { $group: { _id: "$rating", count: { $sum: 1 } } }, { $sort: { _id: -1 } }]),
      Review.aggregate([{ $match: reviewQuery }, { $group: { _id: "$primary_department", count: { $sum: 1 }, avgRating: { $avg: "$rating" } } }]),
      Review.aggregate([{ $match: reviewQuery }, { $group: { _id: "$sentiment", count: { $sum: 1 } } }]),
      Review.aggregate([{ $match: reviewQuery }, { $group: { _id: "$platform", count: { $sum: 1 } } }])
    ]);

    const avgRating = avgRatingAgg[0]?.avg || 0;
    const responseRate = responseRateAgg[0] ? Math.round((responseRateAgg[0].responded / responseRateAgg[0].total) * 100) : 0;
    const avgResponseTime = avgResponseTimeAgg[0] ? Math.round(avgResponseTimeAgg[0].avgHours) : 0;

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    ratingDistAgg.forEach(item => { if (item._id && ratingDistribution[item._id] !== undefined) ratingDistribution[item._id] = item.count; });

    const departmentBreakdown = deptBreakdownAgg.map(d => ({ department: d._id || "Other", count: d.count, avgRating: Math.round((d.avgRating || 0) * 10) / 10 }));
    const sentimentBreakdown = { Positive: 0, Neutral: 0, Negative: 0, Mixed: 0 };
    sentimentBreakdownAgg.forEach(item => { if (item._id && sentimentBreakdown[item._id] !== undefined) sentimentBreakdown[item._id] = item.count; });
    const platformBreakdown = platformBreakdownAgg.map(p => ({ platform: p._id || "Other", count: p.count }));

    res.json({
      success: true,
      data: {
        totalReviews, avgRating: Math.round(avgRating * 10) / 10, criticalIssues, escalationRisk, pendingTickets,
        responseRate, avgResponseTime, ratingDistribution, departmentBreakdown, sentimentBreakdown, platformBreakdown,
        totalStaff: staffCount, activeStaff: activeColleagues,
        previousPeriodReviews: previousPeriodReviews || 0,
        reviewsWithResponse: reviewsWithResponse || 0
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getSentimentTrend = async (req, res, next) => {
  try {
    const hotel_id = await getHotelId(req);

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
    const hotel_id = await getHotelId(req);

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
