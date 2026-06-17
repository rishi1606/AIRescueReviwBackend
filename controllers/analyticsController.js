const Review = require("../models/Review");
const Ticket = require("../models/Ticket");
const Staff = require("../models/Staff");

exports.getSummary = async (req, res, next) => {
  try {
    const { dateStart, dateEnd } = req.query;
    const hotel_id = req.user.hotel_id;

    // Scoping for standard staff and department heads
    let userDept = null;
    if (req.user.role === "staff" || req.user.role === "dept_head") {
      userDept = req.user.department;
      if (!userDept) {
        const staff = await Staff.findById(req.user.id);
        if (staff) userDept = staff.department;
      }
    }

    let reviewQuery = { hotel_id };
    let ticketQuery = { hotel_id };

    if (userDept) {
      reviewQuery.primary_department = userDept;
      ticketQuery.department = userDept;
    }

    if (dateStart || dateEnd) {
      reviewQuery.review_date = {};
      ticketQuery.created_at = {};
      if (dateStart) {
        reviewQuery.review_date.$gte = dateStart;
        ticketQuery.created_at.$gte = parseInt(dateStart);
      }
      if (dateEnd) {
        reviewQuery.review_date.$lte = dateEnd;
        ticketQuery.created_at.$lte = parseInt(dateEnd);
      }
    }

    const [reviews, tickets] = await Promise.all([
      Review.find(reviewQuery),
      Ticket.find(ticketQuery)
    ]);

    const totalReviews = reviews.length;
    const positiveCount = reviews.filter(r => r.sentiment === "Positive").length;
    const negativeCount = reviews.filter(r => r.sentiment === "Negative").length;
    const mixedCount = reviews.filter(r => r.sentiment === "Mixed").length;
    const neutralCount = reviews.filter(r => r.sentiment === "Neutral").length;
    
    const avgRating = totalReviews > 0 
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1) 
      : "0.0";

    const pendingAI = reviews.filter(r => r.status === "Pending AI" || r.status === "Pending").length;
    const criticalCount = tickets.filter(t => t.urgency === "High" && t.status === "Open").length;
    const approvedCount = reviews.filter(r => r.status === "Approved").length;
    const resolvedTickets = tickets.filter(t => t.status === "Closed" || t.status === "Resolved").length;
    
    const overdueTickets = tickets.filter(t => 
      t.sla_deadline < Date.now() && 
      !["Closed", "Resolved"].includes(t.status)
    ).length;

    const closedTickets = tickets.filter(t => t.resolved_at && t.created_at);
    const avgResolutionHours = closedTickets.length > 0 
      ? Math.round(closedTickets.reduce((sum, t) => sum + ((t.resolved_at - t.created_at) / 3600000), 0) / closedTickets.length) 
      : 0;

    const requiresResponse = reviews.filter(r => r.requires_response && r.status !== "Approved").length;
    const responseRate = requiresResponse > 0 ? Math.round((approvedCount / (approvedCount + requiresResponse)) * 100) : 0;

    const departmentBreakdown = tickets.reduce((acc, t) => {
      acc[t.department] = (acc[t.department] || 0) + 1;
      return acc;
    }, {});

    const platformBreakdown = reviews.reduce((acc, r) => {
      acc[r.platform] = (acc[r.platform] || 0) + 1;
      return acc;
    }, {});

    const ratingDistribution = [5, 4, 3, 2, 1].map(star => {
      const count = reviews.filter(r => r.rating === star).length;
      return {
        star,
        count,
        pct: totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0
      };
    });

    // Mock weekly data for now or aggregate if needed
    const weeklyData = []; // Implementation depends on how you want to bucket dates

    const topComplaintsMap = {};
    reviews.forEach(r => {
      if (r.issues) {
        r.issues.forEach(issue => {
          topComplaintsMap[issue] = (topComplaintsMap[issue] || 0) + 1;
        });
      }
    });
    const topComplaints = Object.entries(topComplaintsMap)
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const platformRatingsMap = {};
    reviews.forEach(r => {
      if (!platformRatingsMap[r.platform]) platformRatingsMap[r.platform] = { sum: 0, count: 0 };
      platformRatingsMap[r.platform].sum += r.rating;
      platformRatingsMap[r.platform].count += 1;
    });
    const platformRatings = Object.entries(platformRatingsMap).map(([platform, data]) => ({
      platform,
      avgRating: (data.sum / data.count).toFixed(1)
    }));

    const departmentPerformance = Object.keys(departmentBreakdown).map(dept => {
      const deptTickets = tickets.filter(t => t.department === dept);
      const resolved = deptTickets.filter(t => ["Closed", "Resolved"].includes(t.status)).length;
      const closed = deptTickets.filter(t => t.resolved_at && t.created_at);
      const avgTime = closed.length > 0 
        ? Math.round(closed.reduce((sum, t) => sum + ((t.resolved_at - t.created_at) / 3600000), 0) / closed.length) 
        : 0;
      return {
        dept,
        tickets: deptTickets.length,
        resolved,
        avgTime,
        open: deptTickets.length - resolved
      };
    });

    res.json({
      success: true,
      data: {
        totalReviews, positiveCount, negativeCount, mixedCount,
        neutralCount, avgRating, pendingAI, criticalCount,
        approvedCount, resolvedTickets, overdueTickets,
        avgResolutionHours, 
        escalationRisks: reviews.filter(r => r.escalation_risk).length,
        suspiciousCount: reviews.filter(r => r.is_suspicious).length,
        needsHumanReview: reviews.filter(r => r.needs_human_review).length,
        requiresResponse, responseRate,
        departmentBreakdown,
        platformBreakdown,
        ratingDistribution,
        weeklyData,
        topComplaints,
        platformRatings,
        departmentPerformance
      }
    });
  } catch (err) {
    next(err);
  }
};
