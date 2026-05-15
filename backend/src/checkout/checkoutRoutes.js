const express = require("express");
const checkoutService = require("./checkoutService");
const { requireAuth } = require("../auth/authMiddleware");

const router = express.Router();

// POST /v1/checkout/from-cart
router.post("/from-cart", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const { cart_item_ids } = req.body;

const result = await checkoutService.checkoutFromCart(user_id, cart_item_ids);

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

module.exports = router;