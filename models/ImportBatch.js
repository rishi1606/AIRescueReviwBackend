const mongoose = require("mongoose");

const importBatchSchema = new mongoose.Schema({
  hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },
  filename: { type: String, required: true },
  status: { type: String, enum: ["Processing", "Completed", "Failed"], default: "Processing" },
  totalCount: { type: Number, default: 0 },
  validCount: { type: Number, default: 0 },
  duplicateCount: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  errors: [String],
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model("ImportBatch", importBatchSchema);
