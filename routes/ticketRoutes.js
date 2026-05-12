const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const auth = require("../middleware/auth");

router.get("/", auth, ticketController.getTickets);
router.post("/", auth, ticketController.createTicket);
router.put("/:ticket_id/status", auth, ticketController.updateStatus);
router.put("/:ticket_id/assign", auth, ticketController.assign);
router.put("/:ticket_id/escalate", auth, ticketController.escalate);
router.post("/:ticket_id/notes", auth, ticketController.addNote);
router.post("/:ticket_id/attachments", auth, ticketController.addAttachment);
router.post("/cluster", auth, ticketController.clusterTickets);
router.put("/bulk-assign", auth, ticketController.bulkAssign);
router.put("/bulk-status", auth, ticketController.bulkStatus);

module.exports = router;
