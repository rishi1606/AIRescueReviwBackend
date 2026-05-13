const Ticket = require("../models/Ticket");
const Hotel = require("../models/Hotel");
const Review = require("../models/Review");

exports.createTicketFromReview = async (review, hotelId) => {
  try {
    const hotel = await Hotel.findById(hotelId);
    if (!hotel?.aiConfig?.autoTicket) return null;

    // SLA Calculation Logic (Department priority, then urgency)
    const slaConfig = hotel.slaConfig || { high: 4, medium: 24, low: 72 };
    const deptSla = hotel.deptSlaConfig || {};
    
    const urgencyKey = (review.urgency || "Medium").toLowerCase();
    const deptName = review.primary_department;
    
    let deptHours;
    if (deptName) {
      const foundDeptKey = Object.keys(deptSla).find(k => k.toLowerCase() === deptName.toLowerCase());
      if (foundDeptKey) deptHours = deptSla[foundDeptKey];
    }

    let urgencyHours;
    if (urgencyKey) {
      const foundUrgencyKey = Object.keys(slaConfig).find(k => k.toLowerCase() === urgencyKey.toLowerCase());
      if (foundUrgencyKey) urgencyHours = slaConfig[foundUrgencyKey];
    }

    const hours = deptHours || urgencyHours || 24;
    const deadline = Date.now() + (hours * 60 * 60 * 1000);

    const ticket = new Ticket({
      ticket_id: "TKT-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5).toUpperCase(),
      hotel_id: hotelId,
      review_id: review.review_id,
      guest_name: review.guest_name,
      rating: review.rating,
      review_text: review.review_text,
      department: review.primary_department || "Management",
      urgency: review.urgency || "Medium",
      status: "Open",
      created_at: Date.now(),
      sla_deadline: deadline,
      status_history: [{
        status: "Open",
        changed_by: "System — AI Auto-Ticket",
        timestamp: Date.now()
      }]
    });

    await ticket.save();

    // Link back to review
    await Review.findOneAndUpdate(
      { review_id: review.review_id, hotel_id: hotelId },
      { linked_ticket_id: ticket.ticket_id }
    );

    return ticket;
  } catch (err) {
    console.error("Failed to create ticket from review:", err);
    return null;
  }
};
