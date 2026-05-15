const express = require("express");
const evidenceRepo = require("./evidenceRepo");

const router = express.Router();

// POST /v1/orders/:id/evidence
router.post("/orders/:id/evidence", async (req, res) => {
  const order_id = req.params.id;
  const { uploaded_by, media_type, storage_key } = req.body;

  if (!uploaded_by || !media_type || !storage_key) {
    return res.status(400).json({ error: "uploaded_by, media_type, storage_key are required" });
  }

  const row = await evidenceRepo.insertEvidence({ order_id, uploaded_by, media_type, storage_key });
  res.status(201).json(row);
});

// GET /v1/orders/:id/evidence
router.get("/orders/:id/evidence", async (req, res) => {
  const rows = await evidenceRepo.listEvidence(req.params.id);
  res.json({ order_id: req.params.id, evidence: rows });
});

module.exports = router;