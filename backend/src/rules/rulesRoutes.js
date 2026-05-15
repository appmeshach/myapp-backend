const express = require("express");
const orderRepo = require("../orders/orderRepo");
const { requiredEvidenceForDispute } = require("./evidenceRequirements");

const router = express.Router();

// GET /v1/orders/:id/required-evidence
router.get("/orders/:id/required-evidence", async (req, res) => {
  const order = await orderRepo.getById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const reqs = requiredEvidenceForDispute(order);
  res.json(reqs);
});

module.exports = router;