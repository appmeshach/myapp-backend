const express = require("express");
const { requireAuth } = require("../auth/authMiddleware");
const { query } = require("../db");
const orderRepo = require("../orders/orderRepo");
const { requireRole } = require("../auth/requireRole");
const idempotency = require("../middleware/idempotencyMiddleware");
const auditRepo = require("../audit/auditRepo");

const router = express.Router();

/*
Helper:
Load order by id
*/
async function getOrder(id) {
  const r = await query(
    `
    SELECT *
    FROM orders
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  return r.rows[0] || null;
}

/*
POST /v1/ops/orders/:id/start-transit
HANDOVER_TO_RIDER → IN_TRANSIT
*/
router.post("/orders/:id/start-transit", requireAuth, requireRole("OPS"), idempotency, async (req, res, next) => {
  try {
    const order = await getOrder(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.state !== "HANDOVER_TO_RIDER") {
      return res.status(409).json({
        error: "Only HANDOVER_TO_RIDER orders can start transit",
      });
    }

    const updated = await orderRepo.updateState(order.id, "IN_TRANSIT");

        await auditRepo.logEvent({
      actor_user_id: req.auth.user_id,
      actor_role: req.auth.role,
      action: "OPS_STARTED_TRANSIT",
      entity_type: "ORDER",
      entity_id: updated.id,
      meta: {
        from_state: order.state,
        to_state: updated.state,
      },
    });

    res.json({ order: updated });
  } catch (e) {
    next(e);
  }
});

/*
POST /v1/ops/orders/:id/mark-delivered
IN_TRANSIT → INSPECTION_ACTIVE
*/
router.post("/orders/:id/mark-delivered", requireAuth, requireRole("OPS"), idempotency, async (req, res, next) => {
  try {
    const order = await getOrder(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.state !== "IN_TRANSIT") {
      return res.status(409).json({
        error: "Only IN_TRANSIT orders can be delivered",
      });
    }

    const updated = await orderRepo.updateState(order.id, "INSPECTION_ACTIVE");

        await auditRepo.logEvent({
      actor_user_id: req.auth.user_id,
      actor_role: req.auth.role,
      action: "OPS_MARKED_DELIVERED",
      entity_type: "ORDER",
      entity_id: updated.id,
      meta: {
        from_state: order.state,
        to_state: updated.state,
      },
    });

    res.json({ order: updated });
  } catch (e) {
    next(e);
  }
});

module.exports = router;