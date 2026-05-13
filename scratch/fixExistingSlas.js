const mongoose = require("mongoose");
require("dotenv").config();
const Ticket = require("../models/Ticket");
const Hotel = require("../models/Hotel");

async function fixSLAs() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB...");

  const openTickets = await Ticket.find({ status: { $nin: ["Closed", "Resolved"] } });
  console.log(`Found ${openTickets.length} open tickets to fix.`);

  for (let t of openTickets) {
    const hotel = await Hotel.findById(t.hotel_id);
    if (!hotel) continue;

    const slaConfig = hotel.slaConfig || { high: 4, medium: 24, low: 72 };
    const deptSla = hotel.deptSlaConfig || {};
    
    const urgencyKey = (t.urgency || "Medium").toLowerCase();
    const deptName = t.department;
    
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
    const newDeadline = t.created_at + (hours * 60 * 60 * 1000);

    console.log(`Updating Ticket ${t.ticket_id}: Dept=${deptName}, Urgency=${t.urgency}, Hours=${hours}`);
    t.sla_deadline = newDeadline;
    await t.save();
  }

  console.log("All open tickets updated!");
  process.exit();
}

fixSLAs();
