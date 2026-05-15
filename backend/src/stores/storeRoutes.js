const express = require("express");
const storeService = require("./storeService");

const router = express.Router();

// GET /v1/stores
router.get("/", async (req, res) => {
  const stores = await storeService.listStores();
  res.json({ stores });
});

// GET /v1/stores/:id
router.get("/:id", async (req, res) => {
  const store = await storeService.getStoreById(req.params.id);
  if (!store) return res.status(404).json({ error: "Store not found" });
  res.json(store);
});

// GET /v1/stores/:id/products
router.get("/:id/products", async (req, res) => {
  const products = await storeService.listStoreProducts(req.params.id);
  res.json({ store_id: req.params.id, products });
});

module.exports = router;