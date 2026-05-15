const express = require("express");
const wishlistService = require("./wishlistService");
const { requireAuth } = require("../auth/authMiddleware");

const router = express.Router();

// POST /v1/wishlist/items
router.post("/items", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const { product_id } = req.body;

    if (!product_id) {
      return res.status(400).json({ error: "product_id is required" });
    }

    const item = await wishlistService.addItem({ user_id, product_id });

    if (!item) {
      return res.status(200).json({ ok: true, message: "Already in wishlist" });
    }

    res.status(201).json(item);
  } catch (e) {
    next(e);
  }
});

// GET /v1/wishlist
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const items = await wishlistService.listItems(user_id);
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// DELETE /v1/wishlist/items/:id
router.delete("/items/:id", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
const deleted = await wishlistService.removeItem(req.params.id, user_id);

    if (!deleted) {
      return res.status(404).json({ error: "Wishlist item not found" });
    }

    res.json({ ok: true, deleted });
  } catch (e) {
    next(e);
  }
});

module.exports = router;