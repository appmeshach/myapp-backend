const express = require("express");
const homeService = require("./homeService");

const router = express.Router();

// GET /v1/home
router.get("/", async (req, res, next) => {
  try {
    const data = await homeService.getHomeFeed();
    res.json(data);
  } catch (e) {
    next(e);
  }
});

module.exports = router;