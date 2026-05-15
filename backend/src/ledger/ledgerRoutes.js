const express = require("express");
const ledgerRepo = require("./ledgerRepo");

const router = express.Router();

// Read-only ledger for an order
router.get("/orders/:id/ledger", async (req, res) => {
  const rows = await ledgerRepo.listEntriesByOrder(req.params.id);
  res.json({ order_id: req.params.id, entries: rows });
});

module.exports = router;