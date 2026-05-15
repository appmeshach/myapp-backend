const express = require("express");
const categoryService = require("./categoryService");

const router = express.Router();

// GET /v1/categories
router.get("/", async (req, res, next) => {
  try {
    const categories = await categoryService.getCategories();
    res.json({ categories });
  } catch (e) {
    next(e);
  }
});

// GET /v1/categories/:category_group/products
router.get("/:category_group/products", async (req, res, next) => {
  try {
    const products = await categoryService.getProductsByCategory(req.params.category_group);
    res.json({
      category_group: req.params.category_group,
      products,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;