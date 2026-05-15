const disputeRepo = require("./disputeRepo");
const express = require("express");
const disputeService = require("./disputeService");


const router = express.Router();

// POST /v1/orders/:id/disputes
router.post("/orders/:id/disputes", async (req, res) => {
  const { reason_code } = req.body;
  if (!reason_code) return res.status(400).json({ error: "reason_code required" });

  const out = await disputeService.openDispute(req.params.id, reason_code);
  if (out.error) return res.status(out.status).json({ error: out.error });

  res.status(201).json(out.dispute);
});

// GET /v1/orders/:id/disputes
router.get("/orders/:id/disputes", async (req, res) => {
  const d = await disputeRepo.getDisputeByOrder(req.params.id);
  if (!d) return res.status(404).json({ error: "Dispute not found" });
  res.json(d);
});

// POST /v1/orders/:id/disputes/resolve  (Admin-only later)
router.post("/orders/:id/disputes/resolve", async (req, res) => {
  const { decision, fault_attribution } = req.body;
  if (!decision || !fault_attribution) {
    return res.status(400).json({ error: "decision and fault_attribution required" });
  }

  const out = await disputeService.resolveDispute(req.params.id, { decision, fault_attribution });
  if (out.error) return res.status(out.status).json({ error: out.error });

  res.json(out.dispute);
});

module.exports = router;