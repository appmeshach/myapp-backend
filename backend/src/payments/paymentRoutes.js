const express = require("express");
const paymentService = require("./paymentService");
const { requireAuth } = require("../auth/authMiddleware");
const { requireRole } = require("../auth/requireRole");
const idempotency = require("../middleware/idempotencyMiddleware");

const router = express.Router();

// POST /v1/payments/confirm
router.post("/confirm", requireAuth, requireRole("OPS"), idempotency, async (req, res, next) => {
  try {
    const { order_id } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: "order_id required" });
    }

    const result = await paymentService.confirmPayment(order_id);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /v1/payments/confirm-group
router.post("/confirm-group", requireAuth, requireRole("OPS"), idempotency, async (req, res, next) => {
  try {
    const { checkout_group_id } = req.body;

    if (!checkout_group_id) {
      return res.status(400).json({ error: "checkout_group_id required" });
    }

    const result = await paymentService.confirmPaymentGroup(checkout_group_id);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// POST /v1/payments/confirm-batch
router.post("/confirm-batch", requireAuth, requireRole("OPS"), idempotency, async (req, res, next) => {
  try {
    const { order_ids } = req.body;

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ error: "order_ids must be a non-empty array" });
    }

    const result = await paymentService.confirmPaymentBatch(order_ids);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;