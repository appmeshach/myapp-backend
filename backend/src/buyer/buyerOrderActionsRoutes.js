const express = require("express");
const { requireAuth } = require("../auth/authMiddleware");
const { query } = require("../db");
const orderRepo = require("../orders/orderRepo");
const disputeService = require("../disputes/disputeService");
const ledgerService = require("../ledger/ledgerService");
const { requireRole } = require("../auth/requireRole");
const idempotency = require("../middleware/idempotencyMiddleware");
const auditRepo = require("../audit/auditRepo");

const router = express.Router();

/*
Helper: load buyer-owned order
*/
async function getBuyerOrder(orderId, userId) {
  const r = await query(
    `
    SELECT *
    FROM orders
    WHERE id = $1
      AND buyer_user_id = $2
    LIMIT 1
    `,
    [orderId, userId]
  );

  return r.rows[0] || null;
}

/*
POST /v1/buyer/orders/:id/accept
INSPECTION_ACTIVE → SETTLED + settlement ledger
*/
router.post("/orders/:id/accept", requireAuth, requireRole("BUYER"), idempotency, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const order = await getBuyerOrder(req.params.id, user_id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.state !== "INSPECTION_ACTIVE") {
      return res.status(409).json({
        error: "Only INSPECTION_ACTIVE orders can be accepted",
      });
    }

    // Prevent duplicate settlement
    const alreadySettled = order.state === "SETTLED";
    if (alreadySettled) {
      return res.status(409).json({ error: "Order already settled" });
    }

    // Move state first
    const updated = await orderRepo.updateState(order.id, "SETTLED");

    // Record settlement ledger entries
    await ledgerService.recordSettlement(updated);

        await auditRepo.logEvent({
      actor_user_id: req.auth.user_id,
      actor_role: req.auth.role,
      action: "BUYER_ACCEPTED_ORDER",
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
POST /v1/buyer/orders/:id/dispute
Uses real dispute service and correct state: DISPUTE_OPENED
Body: { reason_code: "ITEM_NOT_AS_DESCRIBED" }
*/
router.post("/orders/:id/dispute", requireAuth, requireRole("BUYER"), idempotency, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const order = await getBuyerOrder(req.params.id, user_id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { reason_code } = req.body;

    if (!reason_code) {
      return res.status(400).json({ error: "reason_code required" });
    }

    const result = await disputeService.openDispute(order.id, reason_code);

if (result.error) {
  return res.status(result.status).json({ error: result.error });
}

await auditRepo.logEvent({
  actor_user_id: req.auth.user_id,
  actor_role: req.auth.role,
  action: "BUYER_OPENED_DISPUTE",
  entity_type: "ORDER",
  entity_id: order.id,
  meta: {
    reason_code,
    dispute_id: result.dispute.id,
  },
});

    res.status(201).json(result.dispute);
  } catch (e) {
    next(e);
  }
});

module.exports = router;