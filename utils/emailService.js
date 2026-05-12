const nodemailer = require("nodemailer");

/**
 * Nice Email Template for Escalations
 */
const getEscalationTemplate = (data) => {
  const { hotel_name, guest_name, rating, review_text, escalation_reason, department, ticket_id } = data;
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);

  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
      <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 32px 24px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">ESCALATION ALERT</h1>
        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px; font-weight: 600; text-transform: uppercase;">Management Attention Required</p>
      </div>
      
      <div style="padding: 32px 24px;">
        <div style="margin-bottom: 24px;">
          <p style="margin: 0; color: #64748b; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Hotel Property</p>
          <p style="margin: 4px 0 0; color: #0f172a; font-size: 18px; font-weight: 700;">${hotel_name}</p>
        </div>

        <div style="background-color: #fff7ed; border-left: 4px solid #f97316; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; color: #9a3412; font-size: 12px; font-weight: 800; text-transform: uppercase;">Escalation Reason</p>
          <p style="margin: 4px 0 0; color: #7c2d12; font-size: 15px; font-medium: 500; line-height: 1.5;">${escalation_reason}</p>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
             <div>
               <p style="margin: 0; color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase;">Guest Name</p>
               <p style="margin: 2px 0 0; color: #0f172a; font-size: 14px; font-weight: 700;">${guest_name}</p>
             </div>
             <div style="text-align: right;">
               <p style="margin: 0; color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase;">Rating</p>
               <p style="margin: 2px 0 0; color: #f59e0b; font-size: 14px; font-weight: 700;">${stars}</p>
             </div>
          </div>
          
          <p style="margin: 12px 0 0; color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase;">Review Content</p>
          <p style="margin: 4px 0 0; color: #334155; font-size: 13px; font-style: italic; line-height: 1.6;">"${review_text}"</p>
        </div>

        <div style="display: grid; grid-template-cols: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
           <div style="background-color: #f1f5f9; padding: 12px; border-radius: 8px;">
             <p style="margin: 0; color: #64748b; font-size: 10px; font-weight: 800; text-transform: uppercase;">Department</p>
             <p style="margin: 2px 0 0; color: #0f172a; font-size: 13px; font-weight: 700;">${department}</p>
           </div>
           <div style="background-color: #f1f5f9; padding: 12px; border-radius: 8px;">
             <p style="margin: 0; color: #64748b; font-size: 10px; font-weight: 800; text-transform: uppercase;">Ticket ID</p>
             <p style="margin: 2px 0 0; color: #4f46e5; font-size: 13px; font-weight: 700;">#${ticket_id}</p>
           </div>
        </div>

        <a href="${process.env.CLIENT_URL}/tickets" style="display: block; width: 100%; padding: 14px 0; background-color: #4f46e5; color: white; text-align: center; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">VIEW TICKET DETAILS</a>
      </div>

      <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; color: #94a3b8; font-size: 12px;">This is an automated operational alert from ReviewRescue AI.</p>
      </div>
    </div>
  `;
};

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.ethereal.email",
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_PORT == 465, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

exports.sendEscalationEmail = async (recipient, data) => {
  try {
    const info = await transporter.sendMail({
      from: `"ReviewRescue Alerts" <${process.env.EMAIL_USER || 'no-reply@reviewrescue.com'}>`,
      to: recipient,
      subject: `🚨 ESCALATION: ${data.hotel_name} — Guest ${data.guest_name}`,
      html: getEscalationTemplate(data),
    });

    console.log("Escalation email sent: %s", info.messageId);
    // If using ethereal, log preview URL
    if (process.env.EMAIL_HOST === "smtp.ethereal.email" || !process.env.EMAIL_HOST) {
      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    }
    return true;
  } catch (error) {
    console.error("Error sending escalation email:", error);
    return false;
  }
};
