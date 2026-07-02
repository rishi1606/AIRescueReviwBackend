const Notification = require('../models/Notification');
const Staff = require('../models/Staff');
const Hotel = require('../models/Hotel');

/**
 * Service to handle all 10 ReviewRescue workflow notification events.
 */
const workflowNotificationService = {
  // 1. STAFF GETS ASSIGNED A REVIEW
  notifyReviewAssigned: async (review, assignedBy) => {
    try {
      if (!review) return;
      const staffId = review.assigned_to_staff_id || review.assignee_id;
      if (!staffId || !review.hotel_id) return;

      // Do not notify if assigned to self
      if (assignedBy && (assignedBy._id?.toString() === staffId.toString() || assignedBy.id?.toString() === staffId.toString())) {
        return;
      }

      const platform = review.platform || "Platform";
      const guestName = review.reviewer_name || "Guest";
      const rating = review.rating || 5;

      await Notification.create({
        recipientId: staffId,
        hotelId: review.hotel_id,
        type: "ticket_assigned",
        title: "📝 Review Assigned",
        message: `New review assigned to you: Guest review from ${platform} - ${guestName} gave ${rating} stars. Open My Reviews → To Do`,
        link_to: `/reviews/${review.review_id || review._id}`,
        relatedReviewId: review._id,
        actionData: {
          staffName: review.assigned_to_staff_name || review.assignee_name || "Staff",
          guestName,
          reviewRating: rating,
          assignedFromStaffId: assignedBy?._id || assignedBy?.id
        }
      });
      console.log(`[WorkflowNotification] Event 1 sent to staff ${staffId} for review ${review.review_id}`);
    } catch (err) {
      console.error("[WorkflowNotification] notifyReviewAssigned error:", err.message);
    }
  },

  // 2. LEAD APPROVES STAFF SUBMISSION
  notifyLeadApproved: async (review, approvedBy) => {
    try {
      if (!review || !review.hotel_id) return;
      let staffId = review.assigned_to_staff_id || review.assignee_id;
      if (!staffId && review.submitted_by) {
        const staff = await Staff.findOne({
          $or: [{ name: review.submitted_by }, { email: review.submitted_by }],
          $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
        });
        if (staff) staffId = staff._id;
      }

      const guestName = review.reviewer_name || "Guest";

      // 1. Notify Staff member who submitted response
      if (staffId && (!approvedBy || (approvedBy._id?.toString() !== staffId.toString() && approvedBy.id?.toString() === staffId.toString()))) {
        await Notification.create({
          recipientId: staffId,
          hotelId: review.hotel_id,
          type: "response_approved",
          title: "✅ Response Approved",
          message: `Your response approved! ✅ Guest: ${guestName}. Status: Sent to Business Owner for final approval.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: {
            guestName,
            gmComment: typeof approvedBy === "string" ? approvedBy : (approvedBy?.name || "Lead")
          }
        });
        console.log(`[WorkflowNotification] Event 2 sent to staff ${staffId} for review ${review.review_id}`);
      }

      // 2. Notify Business Owner(s) that response is ready for final approval
      const ownerQuery = {
        role: { $in: ["owner", "gm", "property_manager"] },
        is_active: true,
        $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
      };
      let owners = await Staff.find(ownerQuery);
      if (!owners || owners.length === 0) {
        delete ownerQuery.$or;
        owners = await Staff.find(ownerQuery);
      }
      for (const owner of owners) {
        if (approvedBy && (approvedBy._id?.toString() === owner._id.toString() || approvedBy.id?.toString() === owner._id.toString())) {
          continue;
        }
        await Notification.create({
          recipientId: owner._id,
          hotelId: review.hotel_id,
          type: "response_approved",
          title: "⭐ Ready for Final Approval",
          message: `Lead approved response! ✅ Guest: ${guestName}. Ready for your final approval and publishing.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName }
        });
        console.log(`[WorkflowNotification] Event 2 (Lead Approved) sent to owner ${owner._id} for review ${review.review_id}`);
      }
    } catch (err) {
      console.error("[WorkflowNotification] notifyLeadApproved error:", err.message);
    }
  },

  // 3. LEAD REQUESTS CHANGES FROM STAFF
  notifyLeadRequestedChanges: async (review, leadBy, rejectionReason) => {
    try {
      if (!review || !review.hotel_id) return;
      let staffId = review.assigned_to_staff_id || review.assignee_id;
      if (!staffId && review.submitted_by) {
        const staff = await Staff.findOne({
          $or: [{ name: review.submitted_by }, { email: review.submitted_by }]
        });
        if (staff) staffId = staff._id;
      }
      if (!staffId) return;

      const guestName = review.reviewer_name || "Guest";
      const reasonText = rejectionReason || review.rejection_reason || "Please revise response.";

      await Notification.create({
        recipientId: staffId,
        hotelId: review.hotel_id,
        type: "response_rejected",
        title: "🔁 Changes Requested",
        message: `Changes requested on your response. Guest: ${guestName}. Lead's feedback: "${reasonText}". Open My Reviews → To Do to revise.`,
        link_to: `/reviews/${review.review_id || review._id}`,
        relatedReviewId: review._id,
        actionData: {
          guestName,
          rejectionReason: reasonText
        }
      });
      console.log(`[WorkflowNotification] Event 3 sent to staff ${staffId} for review ${review.review_id}`);
    } catch (err) {
      console.error("[WorkflowNotification] notifyLeadRequestedChanges error:", err.message);
    }
  },

  // 4. LEAD REJECTS REVIEW
  notifyReviewRejected: async (review, rejectedBy) => {
    try {
      if (!review || !review.hotel_id) return;
      const staffId = review.assigned_to_staff_id || review.assignee_id;
      if (!staffId) return;

      const guestName = review.reviewer_name || "Guest";

      await Notification.create({
        recipientId: staffId,
        hotelId: review.hotel_id,
        type: "review_rejected",
        title: "❌ Review Rejected",
        message: `Review rejected. Guest: ${guestName}. No response needed. Review removed from workflow.`,
        link_to: `/reviews`,
        relatedReviewId: review._id,
        actionData: { guestName }
      });
      console.log(`[WorkflowNotification] Event 4 sent to staff ${staffId} for review ${review.review_id}`);
    } catch (err) {
      console.error("[WorkflowNotification] notifyReviewRejected error:", err.message);
    }
  },

  // 5. BUSINESS OWNER PUBLISHES RESPONSE & 10. REVIEW MOVED TO PUBLISHED (FULL FLOW)
  notifyOwnerPublished: async (review, publishedBy) => {
    try {
      if (!review || !review.hotel_id) return;
      const guestName = review.reviewer_name || "Guest";
      const platform = review.platform || "Platform";
      const boName = typeof publishedBy === "string" ? publishedBy : (publishedBy?.name || "Business Owner");

      // 1. Find Staff who wrote it
      let staffId = review.assigned_to_staff_id || review.assignee_id;
      let staffName = review.assigned_to_staff_name || review.assignee_name || "Staff";
      if (!staffId && review.submitted_by) {
        const s = await Staff.findOne({ $or: [{ name: review.submitted_by }, { email: review.submitted_by }] });
        if (s) {
          staffId = s._id;
          staffName = s.name;
        }
      }

      if (staffId && (!publishedBy || (publishedBy._id?.toString() !== staffId.toString() && publishedBy.id?.toString() !== staffId.toString()))) {
        await Notification.create({
          recipientId: staffId,
          hotelId: review.hotel_id,
          type: "published",
          title: "🎉 Response Published",
          message: `Published! 🎉 Your response to ${guestName} is now live on ${platform}!`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName }
        });
        console.log(`[WorkflowNotification] Event 5 (Staff) sent to ${staffId}`);
      }

      // 2. Find Lead who approved it (or all Leads in department/hotel)
      let leadName = review.approved_by || "Lead";
      const leadQuery = {
        role: { $in: ["lead", "dept_head"] },
        is_active: true,
        $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
      };
      if (review.primary_department) {
        leadQuery.department = new RegExp(`^${review.primary_department}$`, "i");
      }
      let leads = await Staff.find(leadQuery);
      if (leads.length === 0 && review.primary_department) {
        delete leadQuery.department;
        leads = await Staff.find(leadQuery);
      }
      for (const lead of leads) {
        // Do not duplicate if lead was the staff member or publishedBy
        if (staffId && lead._id.toString() === staffId.toString()) continue;
        if (publishedBy && (publishedBy._id?.toString() === lead._id.toString() || publishedBy.id?.toString() === lead._id.toString())) continue;
        await Notification.create({
          recipientId: lead._id,
          hotelId: review.hotel_id,
          type: "published",
          title: "🎉 Response Published",
          message: `Published! Response for ${guestName} approved by BO and now live.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName }
        });
        console.log(`[WorkflowNotification] Event 5 (Lead) sent to ${lead._id}`);
      }

      // 3. Event 10: Super Admin (for monitoring only)
      const superAdmins = await Staff.find({ role: "superadmin", is_active: true });
      for (const admin of superAdmins) {
        if (publishedBy && (publishedBy._id?.toString() === admin._id.toString() || publishedBy.id?.toString() === admin._id.toString())) continue;
        await Notification.create({
          recipientId: admin._id,
          hotelId: review.hotel_id,
          type: "superadmin_published",
          title: "📊 Review Published",
          message: `Review published. Guest: ${guestName}. Staff: ${staffName}. Lead: ${leadName}. BO: ${boName}. Response live on ${platform}.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName, staffName }
        });
        console.log(`[WorkflowNotification] Event 10 (SuperAdmin) sent to ${admin._id}`);
      }
    } catch (err) {
      console.error("[WorkflowNotification] notifyOwnerPublished error:", err.message);
    }
  },

  // 6. BUSINESS OWNER REJECTS & SENDS BACK TO LEAD
  notifyOwnerRejectedToLead: async (review, rejectedBy, rejectionReason) => {
    try {
      if (!review || !review.hotel_id) return;
      const guestName = review.reviewer_name || "Guest";
      const reasonText = rejectionReason || review.rejection_reason || "Needs revision.";

      // Find Leads of that department/hotel
      const leadQuery = {
        role: { $in: ["lead", "dept_head"] },
        is_active: true,
        $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
      };
      if (review.primary_department) {
        leadQuery.department = new RegExp(`^${review.primary_department}$`, "i");
      }
      let leads = await Staff.find(leadQuery);
      if (leads.length === 0 && review.primary_department) {
        delete leadQuery.department;
        leads = await Staff.find(leadQuery);
      }
      for (const lead of leads) {
        if (rejectedBy && (rejectedBy._id?.toString() === lead._id.toString() || rejectedBy.id?.toString() === lead._id.toString())) continue;
        await Notification.create({
          recipientId: lead._id,
          hotelId: review.hotel_id,
          type: "bo_rejected",
          title: "🔄 Response Rejected by BO",
          message: `Response rejected by BO. Guest: ${guestName}. Reason: "${reasonText}". Review returned to Approvals queue.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName, rejectionReason: reasonText }
        });
        console.log(`[WorkflowNotification] Event 6 sent to lead ${lead._id}`);
      }

      // Also notify the Staff member who submitted the response
      let staffId = review.assigned_to_staff_id || review.assignee_id;
      if (!staffId && review.submitted_by) {
        const staff = await Staff.findOne({
          $or: [{ name: review.submitted_by }, { email: review.submitted_by }],
          $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
        });
        if (staff) staffId = staff._id;
      }
      if (staffId && (!rejectedBy || (rejectedBy._id?.toString() !== staffId.toString() && rejectedBy.id?.toString() !== staffId.toString()))) {
        await Notification.create({
          recipientId: staffId,
          hotelId: review.hotel_id,
          type: "bo_rejected",
          title: "🔄 Response Rejected by BO",
          message: `Response rejected by BO. Guest: ${guestName}. Reason: "${reasonText}". Please revise response.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName, rejectionReason: reasonText }
        });
        console.log(`[WorkflowNotification] Event 6 sent to staff ${staffId}`);
      }
    } catch (err) {
      console.error("[WorkflowNotification] notifyOwnerRejectedToLead error:", err.message);
    }
  },

  // 7. STAFF SUBMITS RESPONSE FOR APPROVAL
  notifyStaffSubmittedResponse: async (review, staffMember) => {
    try {
      if (!review || !review.hotel_id) return;
      const staffName = staffMember?.name || review.submitted_by || review.assigned_to_staff_name || "Staff";
      const guestName = review.reviewer_name || "Guest";
      const rating = review.rating || 5;

      let targetLeads = [];
      if (staffMember?.reporting_to) {
        const lead = await Staff.findById(staffMember.reporting_to);
        if (lead && lead.is_active) targetLeads.push(lead);
      }
      if (targetLeads.length === 0) {
        const leadQuery = {
          role: { $in: ["lead", "dept_head"] },
          is_active: true,
          $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
        };
        if (review.primary_department) {
          leadQuery.department = new RegExp(`^${review.primary_department}$`, "i");
        }
        targetLeads = await Staff.find(leadQuery);
        if (targetLeads.length === 0 && review.primary_department) {
          delete leadQuery.department;
          targetLeads = await Staff.find(leadQuery);
        }
      }

      for (const lead of targetLeads) {
        if (staffMember && (staffMember._id?.toString() === lead._id.toString() || staffMember.id?.toString() === lead._id.toString())) continue;
        await Notification.create({
          recipientId: lead._id,
          hotelId: review.hotel_id,
          type: "submitted",
          title: "📬 New Response Submission",
          message: `New submission from ${staffName}. Guest: ${guestName}. Rating: ${rating} stars. Open Approvals to review.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { staffName, guestName, reviewRating: rating }
        });
        console.log(`[WorkflowNotification] Event 7 sent to lead ${lead._id}`);
      }
    } catch (err) {
      console.error("[WorkflowNotification] notifyStaffSubmittedResponse error:", err.message);
    }
  },

  // 8. NEW REVIEW ARRIVES (AUTO-IMPORTED)
  notifyNewReviewImported: async (review) => {
    try {
      if (!review || !review.hotel_id) return;
      const platform = review.platform || "Platform";
      const guestName = review.reviewer_name || "Guest";
      const rating = review.rating || 5;
      const snippet = (review.review_text || "").substring(0, 60) + ((review.review_text || "").length > 60 ? "..." : "");

      const leadQuery = {
        role: { $in: ["lead", "dept_head", "owner", "gm", "property_manager"] },
        is_active: true,
        $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
      };
      if (review.primary_department) {
        leadQuery.department = new RegExp(`^${review.primary_department}$`, "i");
      }
      let leads = await Staff.find(leadQuery);
      if (leads.length === 0 && review.primary_department) {
        delete leadQuery.department;
        leads = await Staff.find(leadQuery);
      }
      if (leads.length === 0) {
        delete leadQuery.$or;
        leads = await Staff.find(leadQuery);
      }
      const superAdmins = await Staff.find({ role: "superadmin", is_active: true });
      
      const recipients = [...new Map([...leads, ...superAdmins].map(item => [item._id.toString(), item])).values()];

      for (const recipient of recipients) {
        await Notification.create({
          recipientId: recipient._id,
          hotelId: review.hotel_id,
          type: "import",
          title: "📨 New Review Arrived",
          message: `New review on ${platform}. Guest: ${guestName}. Rating: ${rating} stars. "${snippet}". Status: Unassigned. Lead: Assign to staff.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName, reviewRating: rating, department: review.primary_department }
        });
      }
      console.log(`[WorkflowNotification] Event 8 sent for imported review ${review.review_id}`);
    } catch (err) {
      console.error("[WorkflowNotification] notifyNewReviewImported error:", err.message);
    }
  },

  // 9. ESCALATED REVIEW CREATED
  notifyEscalatedReview: async (review) => {
    try {
      if (!review || !review.hotel_id) return;
      const guestName = review.reviewer_name || "Guest";
      const rating = review.rating || 1;
      const issuesList = (review.issues && review.issues.length > 0) ? review.issues.join(", ") : (review.urgency_reason || "Critical negative review");

      const query = {
        role: { $in: ["lead", "dept_head", "owner", "gm", "property_manager"] },
        is_active: true,
        $or: [{ hotelId: review.hotel_id }, { hotel_id: review.hotel_id }, { business_id: review.hotel_id }]
      };
      const staffList = await Staff.find(query);
      const recipients = staffList.filter(s => {
        if (["owner", "gm", "property_manager"].includes(s.role)) return true;
        if (["lead", "dept_head"].includes(s.role)) {
          return !review.primary_department || !s.department || s.department === review.primary_department;
        }
        return false;
      });

      for (const recipient of recipients) {
        await Notification.create({
          recipientId: recipient._id,
          hotelId: review.hotel_id,
          type: "escalation_alert",
          priority: "critical",
          title: "⚠️ Escalated Review Flagged",
          message: `⚠️ Escalated review flagged. Guest: ${guestName}. Rating: ⭐${rating}. Issues: ${issuesList}. Requires priority handling.`,
          link_to: `/reviews/${review.review_id || review._id}`,
          relatedReviewId: review._id,
          actionData: { guestName, reviewRating: rating, department: review.primary_department }
        });
      }
      console.log(`[WorkflowNotification] Event 9 sent for escalated review ${review.review_id}`);
    } catch (err) {
      console.error("[WorkflowNotification] notifyEscalatedReview error:", err.message);
    }
  }
};

module.exports = workflowNotificationService;
