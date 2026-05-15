const express = require("express");
const { requireAuth } = require("../auth/authMiddleware");
const auditRepo = require("./auditRepo");

const router = express.Router();

// GET /v1/audit/orders/:id
router.get("/orders/:id", requireAuth, async (req, res, next) => {
  try {
    const logs = await auditRepo.listByEntity("ORDER", req.params.id);
    res.json({ logs });
  } catch (e) {
    next(e);
  }
});

module.exports = router;