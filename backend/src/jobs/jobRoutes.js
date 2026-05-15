const express = require("express");
const { runInspectionExpiry } = require("./expiryJob");

const router = express.Router();

// POST /v1/jobs/run/inspection-expiry
router.post("/jobs/run/inspection-expiry", async (req, res) => {
  const out = await runInspectionExpiry();
  res.json(out);
});

module.exports = router;