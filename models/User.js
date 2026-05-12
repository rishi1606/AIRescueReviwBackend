const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["superadmin", "gm", "dept_head", "staff"], required: true },
  department: { type: String },
  hotel_id: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" },
  avatar_initials: { type: String },
  onboarding_complete: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
