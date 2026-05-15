const express = require("express");
const profileService = require("./profileService");
const { requireAuth } = require("../auth/authMiddleware");

const router = express.Router();

// GET /v1/profile/orders
router.get("/orders", requireAuth, async (req, res, next) => {
  try {
    const orders = await profileService.getOrders(req.auth.user_id);
    res.json({ orders });
  } catch (e) {
    next(e);
  }
});

// GET /v1/profile/orders/:id
router.get("/orders/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await profileService.getOrderDetails(req.params.id, req.auth.user_id);

    if (!result) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;