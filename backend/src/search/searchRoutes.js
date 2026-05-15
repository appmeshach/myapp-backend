const express = require("express");
const searchService = require("./searchService");

const router = express.Router();

// GET /v1/search/suggest?q=iph
router.get("/suggest", async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length === 0) {
      return res.json({ suggestions: [] });
    }

    const suggestions = await searchService.suggest(q);

    res.json({ suggestions });
  } catch (e) {
    next(e);
  }
});

// GET /v1/search?q=...&store_id=...
router.get("/", async (req, res, next) => {
  try {
    const { q, store_id } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: "q (search text) required" });
    }

    const products = await searchService.search({ q, store_id });

    res.json({ products });
  } catch (e) {
    next(e);
  }
});

module.exports = router;