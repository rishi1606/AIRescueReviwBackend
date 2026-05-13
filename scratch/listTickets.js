const mongoose = require("mongoose");
require("dotenv").config({ path: "./backend/.env" });
const Ticket = require("../models/Ticket");

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const tickets = await Ticket.find({}).sort({ created_at: -1 }).limit(10);
    console.log(JSON.stringify(tickets.map(t => ({
      id: t.ticket_id,
      status: t.status,
      created: new Date(t.created_at).toLocaleString(),
      resolved: t.resolved_at ? new Date(t.resolved_at).toLocaleString() : "N/A",
      duration_ms: t.resolution_duration_ms || "N/A"
    })), null, 2));
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
