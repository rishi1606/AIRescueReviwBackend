const mongoose = require("mongoose");
require("dotenv").config();
const Ticket = require("../models/Ticket");
const Hotel = require("../models/Hotel");

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const tickets = await Ticket.find().sort({ created_at: -1 }).limit(3);
  const hotel = await Hotel.findOne({ hotel_id: tickets[0]?.hotel_id });

  console.log("HOTEL SLA CONFIG:", JSON.stringify(hotel?.slaConfig, null, 2));
  console.log("HOTEL DEPT SLA CONFIG:", JSON.stringify(hotel?.deptSlaConfig, null, 2));
  
  tickets.forEach(t => {
    console.log("---");
    console.log("ID:", t.ticket_id);
    console.log("DEPT:", t.department);
    console.log("URGENCY:", t.urgency);
    console.log("CREATED:", new Date(t.created_at).toLocaleString());
    console.log("DEADLINE:", new Date(t.sla_deadline).toLocaleString());
    const hours = (t.sla_deadline - t.created_at) / 3600000;
    console.log("CALCULATED HOURS:", hours);
  });
  
  process.exit();
}

check();
