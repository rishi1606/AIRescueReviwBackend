module.exports = (req, res, next) => {
  if (req.user && req.user.role === "superadmin") {
    return next();
  }

  res.status(403).json({ success: false, error: "Forbidden: Superadmin access required" });
};
