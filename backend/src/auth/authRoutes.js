const express = require("express");
const authService = require("./authService");
const { requireAuth } = require("./authMiddleware");
const { authLimiter } = require("./authRateLimits");

const router = express.Router();

// POST /v1/auth/signup
router.post("/signup", authLimiter, async (req, res, next) => {
  try {
    const result = await authService.signup(req.body);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

// POST /v1/auth/login
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const result = await authService.login(req.body);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /v1/auth/me
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const result = await authService.getMe(req.auth.user_id);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;