const express = require("express");
const productRepo = require("./productRepo");
const mediaRepo = require("./productMediaRepo");
const variantRepo = require("./productVariantRepo");

const router = express.Router();

// GET /v1/products?store_id=...
router.get("/", async (req, res, next) => {
  try {
    const { store_id } = req.query;

    let products;
    if (store_id) {
      products = await productRepo.listProductsByStore(store_id);
    } else {
      products = await productRepo.listProducts();
    }

    res.json({ products });
  } catch (e) {
    next(e);
  }
});

// GET /v1/products/:id
router.get("/:id", async (req, res, next) => {
  try {
    const p = await productRepo.getProductById(req.params.id);
    if (!p) return res.status(404).json({ error: "Product not found" });

    const media = await mediaRepo.listMedia(req.params.id);
    const variants = await variantRepo.listVariants(req.params.id);

    res.json({ product: p, media, variants });
  } catch (e) {
    next(e);
  }
});

// POST /v1/products/:id/media
// Body: { media_type: "IMAGE" | "MODEL_3D_GLB", storage_key: "...", position?: number }
router.post("/:id/media", async (req, res, next) => {
  try {
    const { media_type, storage_key, position } = req.body;

    if (!media_type || !storage_key) {
      return res.status(400).json({ error: "media_type and storage_key required" });
    }

    const allowed = ["IMAGE", "MODEL_3D_GLB"];
    if (!allowed.includes(media_type)) {
      return res.status(400).json({ error: "Invalid media_type" });
    }

    const created = await mediaRepo.addMedia({
      product_id: req.params.id,
      media_type,
      storage_key,
      position: Number.isInteger(position) ? position : 0,
    });

    res.status(201).json(created);
    } catch (e) {
    // Unique constraint violation in Postgres
    if (e.code === "23505") {
      return res.status(409).json({
        error: "This position is already used for this product. Choose a different position.",
      });
    }
    next(e);
  }
});

// GET /v1/products/:id/variants
router.get("/:id/variants", async (req, res, next) => {
  try {
    const variants = await variantRepo.listVariants(req.params.id);
    res.json({ variants });
  } catch (e) {
    next(e);
  }
});
// POST /v1/products/:id/variants
router.post("/:id/variants", async (req, res, next) => {
  try {
    const { option_label, stock_qty, price_override_kobo } = req.body;

    if (!option_label) {
      return res.status(400).json({ error: "option_label required" });
    }

    const created = await variantRepo.addVariant({
      product_id: req.params.id,
      option_label,
      stock_qty: stock_qty || 0,
      price_override_kobo: price_override_kobo || null,
    });

    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

module.exports = router;