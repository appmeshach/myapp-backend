const express = require("express");
const { requireAuth } = require("../auth/authMiddleware");
const { query } = require("../db");
const mediaRepo = require("../products/productMediaRepo");
const variantRepo = require("../products/productVariantRepo");
const orderRepo = require("../orders/orderRepo");
const orderItemRepo = require("../orders/orderItemRepo");
const { requireRole } = require("../auth/requireRole");
const idempotency = require("../middleware/idempotencyMiddleware");
const auditRepo = require("../audit/auditRepo");

const router = express.Router();

/*
Helper:
Find a seller-owned store
*/
async function getOwnedStoreId(user_id) {
  const storeRes = await query(
    `
    SELECT id
    FROM stores
    WHERE owner_user_id = $1
    LIMIT 1
    `,
    [user_id]
  );

  return storeRes.rows[0]?.id || null;
}

/*
Helper:
Check that a product belongs to the logged-in seller's store
*/
async function getOwnedProduct(user_id, product_id) {
  const res = await query(
    `
    SELECT p.*
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.id = $1
      AND s.owner_user_id = $2
    LIMIT 1;
    `,
    [product_id, user_id]
  );

  return res.rows[0] || null;
}

/*
POST /v1/seller/products
Seller creates product for their own store
*/
router.post("/products", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
const { title, price_kobo, category_group, description } = req.body;

if (!title || !category_group || price_kobo === undefined || price_kobo === null) {
  return res.status(400).json({
    error: "title, price_kobo, category_group required",
  });
}

const parsedPrice = Number(price_kobo);
if (!Number.isInteger(parsedPrice) || parsedPrice < 0) {
  return res.status(400).json({
    error: "price_kobo must be a non-negative integer",
  });
}

    const store_id = await getOwnedStoreId(user_id);

    if (!store_id) {
      return res.status(403).json({
        error: "You do not own a store",
      });
    }

    const created = await query(
      `
      INSERT INTO products (store_id, title, description, price_kobo, category_group)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *;
      `,
      [store_id, title, description || null, parsedPrice, category_group]
    );

    res.status(201).json(created.rows[0]);
  } catch (e) {
    next(e);
  }
});

/*
GET /v1/seller/products
Seller sees their own products
*/
router.get("/products", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const r = await query(
      `
      SELECT p.*
      FROM products p
      JOIN stores s ON s.id = p.store_id
      WHERE s.owner_user_id = $1
      ORDER BY p.created_at DESC;
      `,
      [user_id]
    );

    res.json({ products: r.rows });
  } catch (e) {
    next(e);
  }
});

/*
GET /v1/seller/products/:id
Seller sees their own full product detail
*/
router.get("/products/:id", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const product = await getOwnedProduct(user_id, req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const media = await mediaRepo.listMedia(req.params.id);
    const variants = await variantRepo.listVariants(req.params.id);

    res.json({ product, media, variants });
  } catch (e) {
    next(e);
  }
});

/*
POST /v1/seller/products/:id/media
Seller adds media to their own product
*/
router.post("/products/:id/media", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const product = await getOwnedProduct(user_id, req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const { media_type, storage_key, position } = req.body;

if (!media_type || !storage_key) {
  return res.status(400).json({ error: "media_type and storage_key required" });
}

const allowed = ["IMAGE", "MODEL_3D_GLB"];
if (!allowed.includes(media_type)) {
  return res.status(400).json({ error: "Invalid media_type" });
}

const parsedPosition = Number(position ?? 0);
if (!Number.isInteger(parsedPosition) || parsedPosition < 0) {
  return res.status(400).json({ error: "position must be a non-negative integer" });
}

const created = await mediaRepo.addMedia({
  product_id: req.params.id,
  media_type,
  storage_key,
  position: parsedPosition,
});

    res.status(201).json(created);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({
        error: "This position is already used for this product. Choose a different position.",
      });
    }
    next(e);
  }
});

/*
POST /v1/seller/products/:id/variants
Seller adds variants to their own product
*/
router.post("/products/:id/variants", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;
    const product = await getOwnedProduct(user_id, req.params.id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const { option_label, stock_qty, price_override_kobo } = req.body;

if (!option_label) {
  return res.status(400).json({ error: "option_label required" });
}

const parsedStock = Number(stock_qty ?? 0);
if (!Number.isInteger(parsedStock) || parsedStock < 0) {
  return res.status(400).json({ error: "stock_qty must be a non-negative integer" });
}

let parsedPriceOverride = null;
if (price_override_kobo !== undefined && price_override_kobo !== null && price_override_kobo !== "") {
  parsedPriceOverride = Number(price_override_kobo);

  if (!Number.isInteger(parsedPriceOverride) || parsedPriceOverride < 0) {
    return res.status(400).json({ error: "price_override_kobo must be a non-negative integer" });
  }
}

const created = await variantRepo.addVariant({
  product_id: req.params.id,
  option_label,
  stock_qty: parsedStock,
  price_override_kobo: parsedPriceOverride,
});

    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

/*
GET /v1/seller/orders
Seller sees orders for their own store
*/
router.get("/orders", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const r = await query(
      `
      SELECT
        o.id,
        o.buyer_user_id,
        o.store_id,
        o.state,
        o.item_count,
        o.total_amount_kobo,
        o.delivery_fee_kobo,
        o.platform_fee_kobo,
        o.created_at,
        s.name AS store_name
      FROM orders o
      JOIN stores s ON s.id = o.store_id
      WHERE s.owner_user_id = $1
      ORDER BY o.created_at DESC;
      `,
      [user_id]
    );

    res.json({ orders: r.rows });
  } catch (e) {
    next(e);
  }
});

/*
GET /v1/seller/orders/:id
Seller sees one order detail for their own store
*/
router.get("/orders/:id", requireAuth, requireRole("SELLER"), async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const orderRes = await query(
      `
      SELECT
        o.id,
        o.buyer_user_id,
        o.store_id,
        o.state,
        o.item_count,
        o.total_amount_kobo,
        o.delivery_fee_kobo,
        o.platform_fee_kobo,
        o.created_at,
        s.name AS store_name
      FROM orders o
      JOIN stores s ON s.id = o.store_id
      WHERE o.id = $1
        AND s.owner_user_id = $2
      LIMIT 1;
      `,
      [req.params.id, user_id]
    );

    const order = orderRes.rows[0];
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const items = await orderItemRepo.listOrderItems(req.params.id);

    res.json({ order, items });
  } catch (e) {
    next(e);
  }
});

/*
POST /v1/seller/orders/:id/mark-ready
Seller moves order from ESCROW_LOCKED -> HANDOVER_TO_RIDER
*/
router.post("/orders/:id/mark-ready", requireAuth, requireRole("SELLER"), idempotency, async (req, res, next) => {
  try {
    const user_id = req.auth.user_id;

    const orderRes = await query(
      `
      SELECT o.*
      FROM orders o
      JOIN stores s ON s.id = o.store_id
      WHERE o.id = $1
        AND s.owner_user_id = $2
      LIMIT 1;
      `,
      [req.params.id, user_id]
    );

    const order = orderRes.rows[0];
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.state !== "ESCROW_LOCKED") {
      return res.status(409).json({
        error: "Only ESCROW_LOCKED orders can be marked ready",
      });
    }

    const updated = await orderRepo.updateState(order.id, "HANDOVER_TO_RIDER");

        await auditRepo.logEvent({
      actor_user_id: req.auth.user_id,
      actor_role: req.auth.role,
      action: "SELLER_MARKED_READY",
      entity_type: "ORDER",
      entity_id: updated.id,
      meta: {
        from_state: order.state,
        to_state: updated.state,
      },
    });

    res.json({ order: updated });
  } catch (e) {
    next(e);
  }
});

module.exports = router;