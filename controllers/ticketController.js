const Ticket = require("../models/Ticket");
const Review = require("../models/Review");
const Hotel = require("../models/Hotel");
const User = require("../models/User");
const { sendEscalationEmail } = require("../utils/emailService");

exports.getTickets = async (req, res, next) => {
  try {
    const { department, urgency, status, search, dateStart, dateEnd } = req.query;
    let query = { hotel_id: req.user.hotel_id };

    if (department && department !== "ALL") query.department = department;
    if (urgency && urgency !== "ALL") query.urgency = urgency;
    if (status && status !== "ALL") query.status = status;

    if (dateStart || dateEnd) {
      query.created_at = {};
      if (dateStart) query.created_at.$gte = parseInt(dateStart);
      if (dateEnd) query.created_at.$lte = parseInt(dateEnd);
    }

    if (search) {
      query.$or = [
        { guest_name: { $regex: search, $options: "i" } },
        { ticket_id: { $regex: search, $options: "i" } },
        { review_text: { $regex: search, $options: "i" } }
      ];
    }

    const tickets = await Ticket.find(query).sort({ created_at: -1 });
    res.json({ success: true, data: { tickets, total: tickets.length } });
  } catch (err) {
    next(err);
  }
};

exports.createTicket = async (req, res, next) => {
  try {
    const ticket = new Ticket({
      ...req.body,
      hotel_id: req.user.hotel_id
    });
    await ticket.save();

    if (ticket.review_id) {
      await Review.findOneAndUpdate(
        { review_id: ticket.review_id, hotel_id: req.user.hotel_id },
        { linked_ticket_id: ticket.ticket_id }
      );
    }

    res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { ticket_id } = req.params;
    const { status, changed_by, note } = req.body;
    
    const update = { 
      status, 
      $push: { status_history: { status, changed_by, timestamp: Date.now() } }
    };

    if (status === "Resolved") {
      update.resolved_at = Date.now();
      update.resolution_note = note;
    }
    if (status === "Closed") update.closed_at = Date.now();

    const ticket = await Ticket.findOneAndUpdate(
      { ticket_id, hotel_id: req.user.hotel_id },
      update,
      { new: true }
    );
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

exports.assign = async (req, res, next) => {
  try {
    const { ticket_id } = req.params;
    const { assignee_id, assignee_name } = req.body;
    const ticket = await Ticket.findOneAndUpdate(
      { ticket_id, hotel_id: req.user.hotel_id },
      { assignee_id, assignee_name },
      { new: true }
    );
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

exports.escalate = async (req, res, next) => {
  try {
    const { ticket_id } = req.params;
    const { escalation_reason, assignee_id, assignee_name } = req.body;
    
    const update = { escalated: true, escalation_reason };
    if (assignee_id) update.assignee_id = assignee_id;
    if (assignee_name) update.assignee_name = assignee_name;

    const ticket = await Ticket.findOneAndUpdate(
      { ticket_id, hotel_id: req.user.hotel_id },
      update,
      { new: true }
    );

    // SEND ESCALATION EMAIL
    if (ticket) {
      // 1. Fetch Hotel Info
      const hotel = await Hotel.findById(req.user.hotel_id);
      
      // 2. Fetch GM and Dept Head emails + the current logged-in user
      const managers = await User.find({
        hotel_id: req.user.hotel_id,
        role: { $in: ["gm", "dept_head"] }
      });

      // Combine emails and remove duplicates
      const emailSet = new Set(managers.map(m => m.email));
      emailSet.add(req.user.email); // Always include the current logged-in manager
      
      const recipientEmails = Array.from(emailSet).join(", ");
      
      if (recipientEmails) {
        await sendEscalationEmail(recipientEmails, {
          hotel_name: hotel?.hotel_name || "Hotel Property",
          guest_name: ticket.guest_name,
          rating: ticket.rating || 0,
          review_text: ticket.review_text,
          escalation_reason: escalation_reason,
          department: ticket.department,
          ticket_id: ticket.ticket_id
        });
      }
    }

    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

exports.addNote = async (req, res, next) => {
  try {
    const { ticket_id } = req.params;
    const { text, author } = req.body;
    const ticket = await Ticket.findOneAndUpdate(
      { ticket_id, hotel_id: req.user.hotel_id },
      { $push: { notes: { text, author, timestamp: Date.now() } } },
      { new: true }
    );
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

exports.addAttachment = async (req, res, next) => {
  try {
    const { ticket_id } = req.params;
    const { name, base64 } = req.body;
    const ticket = await Ticket.findOneAndUpdate(
      { ticket_id, hotel_id: req.user.hotel_id },
      { $push: { attachments: { name, base64, timestamp: Date.now() } } },
      { new: true }
    );
    res.json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

exports.clusterTickets = async (req, res, next) => {
  try {
    const { ticket_ids, cluster_id } = req.body;
    const result = await Ticket.updateMany(
      { ticket_id: { $in: ticket_ids }, hotel_id: req.user.hotel_id },
      { cluster_id }
    );
    res.json({ success: true, data: { updated: result.modifiedCount } });
  } catch (err) {
    next(err);
  }
};

exports.bulkAssign = async (req, res, next) => {
  try {
    const { ticket_ids, assignee_id, assignee_name } = req.body;
    const result = await Ticket.updateMany(
      { ticket_id: { $in: ticket_ids }, hotel_id: req.user.hotel_id },
      { assignee_id, assignee_name }
    );
    res.json({ success: true, data: { updated: result.modifiedCount } });
  } catch (err) {
    next(err);
  }
};

exports.bulkStatus = async (req, res, next) => {
  try {
    const { ticket_ids, status, changed_by } = req.body;
    const result = await Ticket.updateMany(
      { ticket_id: { $in: ticket_ids }, hotel_id: req.user.hotel_id },
      { 
        status,
        $push: { status_history: { status, changed_by, timestamp: Date.now() } }
      }
    );
    res.json({ success: true, data: { updated: result.modifiedCount } });
  } catch (err) {
    next(err);
  }
};
