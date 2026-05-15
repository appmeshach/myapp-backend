function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.auth?.role;

    if (!role) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}

module.exports = { requireRole };