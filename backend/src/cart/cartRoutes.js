const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../auth/authMiddleware");

const router = express.Router();

// GET /v1/cart
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const r = await query(
      `
      SELECT
        c.id,
        c.user_id,
        c.store_id,
        c.product_id,
        c.variant_id,
        c.qty,
        c.created_at,
        c.updated_at,
        p.title,
        p.price_kobo,
        p.currency,
        s.name AS store_name,
        v.option_label AS variant_label,
        COALESCE(v.price_override_kobo, p.price_kobo) AS effective_price_kobo
      FROM cart_items c
      JOIN products p ON p.id = c.product_id
      JOIN stores s ON s.id = c.store_id
      LEFT JOIN product_variants v ON v.id = c.variant_id
      WHERE c.user_id = $1
      ORDER BY s.name ASC, c.updated_at DESC;
      `,
      [user_id]
    );

    const rows = r.rows;

    const grouped = new Map();
    let grand_total_kobo = 0;

    for (const row of rows) {
      const unit_price_kobo = Number(row.effective_price_kobo);
      const line_total_kobo = unit_price_kobo * Number(row.qty);
      grand_total_kobo += line_total_kobo;

      if (!grouped.has(row.store_id)) {
        grouped.set(row.store_id, {
          store_id: row.store_id,
          store_name: row.store_name,
          currency: row.currency,
          subtotal_kobo: 0,
          items: [],
        });
      }

      const group = grouped.get(row.store_id);
      group.subtotal_kobo += line_total_kobo;

      group.items.push({
        id: row.id,
        product_id: row.product_id,
        variant_id: row.variant_id,
        variant_label: row.variant_label,
        title: row.title,
        qty: row.qty,
        price_kobo: unit_price_kobo,
        line_total_kobo,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }

    res.json({
      stores: Array.from(grouped.values()),
      grand_total_kobo,
    });
  } catch (e) {
    next(e);
  }
});

// POST /v1/cart/items
router.post("/items", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const { store_id, product_id, variant_id, qty } = req.body;

    if (!store_id || !product_id || qty === undefined || qty === null) {
      return res.status(400).json({ error: "store_id, product_id, qty required" });
    }

    const parsedQty = Number(qty);
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({ error: "qty must be a positive integer" });
    }

    const existing = await query(
      `
      SELECT *
      FROM cart_items
      WHERE user_id = $1
        AND product_id = $2
        AND (
          (variant_id IS NULL AND $3::uuid IS NULL)
          OR variant_id = $3
        )
      LIMIT 1;
      `,
      [user_id, product_id, variant_id || null]
    );

    if (existing.rows[0]) {
      const updated = await query(
        `
        UPDATE cart_items
        SET qty = $2,
            store_id = $3,
            updated_at = now()
        WHERE id = $1
        RETURNING *;
        `,
        [existing.rows[0].id, parsedQty, store_id]
      );

      return res.status(200).json(updated.rows[0]);
    }

    const inserted = await query(
      `
      INSERT INTO cart_items (user_id, store_id, product_id, variant_id, qty)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *;
      `,
      [user_id, store_id, product_id, variant_id || null, parsedQty]
    );

    res.status(201).json(inserted.rows[0]);
  } catch (e) {
    next(e);
  }
});

// DELETE /v1/cart/items/:id
router.delete("/items/:id", requireAuth, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const deleted = await query(
      `
      DELETE FROM cart_items
      WHERE id = $1 AND user_id = $2
      RETURNING *;
      `,
      [req.params.id, user_id]
    );

    if (!deleted.rows[0]) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    res.json({ ok: true, deleted: deleted.rows[0] });
  } catch (e) {
    next(e);
  }
});

module.exports = router;