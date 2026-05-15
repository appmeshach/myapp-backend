const express = require("express");
const service = require("./orderService");
const ledgerService = require("../ledger/ledgerService");
const repo = require("./orderRepo");
const { allowedActions } = require("../rules/allowedActions");
const orderItemRepo = require("./orderItemRepo");

const router = express.Router();

// Create order (payment already succeeded externally)
router.post("/", async (req, res) => {
  const order = await service.createEscrowLockedOrder(req.body);

  console.log("CREATE ORDER: about to write ESCROW_LOCK ledger for", order.id);

  await ledgerService.recordEscrowLock(order);

  console.log("CREATE ORDER: finished writing ESCROW_LOCK ledger for", order.id);

  res.status(201).json(order);
});

// Get order with allowed_actions + timer fields
router.get("/:id", async (req, res) => {
  const order = await repo.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  res.json({
    ...order,
    allowed_actions: allowedActions(order),
  });
});

// Events
router.post("/:id/events/handover_to_rider", async (req, res) => {
  const order = await service.handoverToRider(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

router.post("/:id/events/mark_in_transit", async (req, res) => {
  const order = await service.markInTransit(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

router.post("/:id/events/mark_delivered", async (req, res) => {
  const order = await service.markDelivered(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

router.post("/:id/events/open_dispute", async (req, res) => {
  const order = await service.openDispute(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

router.post("/:id/events/confirm_ok", async (req, res) => {
  const order = await service.confirmOk(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  await ledgerService.recordSettlement(order);

  res.json(order);
});

// GET /v1/orders/:id/items
router.get("/:id/items", async (req, res, next) => {
  try {
    const items = await orderItemRepo.listOrderItems(req.params.id);
    res.json({ order_id: req.params.id, items });
  } catch (e) {
    next(e);
  }
});

module.exports = router;