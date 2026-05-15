const { query } = require("../db");

async function listVariants(productId) {
  const res = await query(
    `
    SELECT *
    FROM product_variants
    WHERE product_id = $1
    ORDER BY created_at ASC
    `,
    [productId]
  );

  return res.rows;
}

async function getVariantById(variantId) {
  const res = await query(
    `
    SELECT *
    FROM product_variants
    WHERE id = $1
    `,
    [variantId]
  );

  return res.rows[0] || null;
}

async function addVariant({ product_id, option_label, stock_qty, price_override_kobo }) {
  const res = await query(
    `
    INSERT INTO product_variants (
      product_id,
      option_label,
      stock_qty,
      price_override_kobo
    )
    VALUES ($1,$2,$3,$4)
    RETURNING *
    `,
    [product_id, option_label, stock_qty, price_override_kobo]
  );

  return res.rows[0];
}

async function reduceStock(variantId, qty) {
  const res = await query(
    `
    UPDATE product_variants
    SET stock_qty = stock_qty - $2
    WHERE id = $1
      AND stock_qty >= $2
    RETURNING *;
    `,
    [variantId, qty]
  );

  return res.rows[0] || null;
}

module.exports = { listVariants, getVariantById, addVariant, reduceStock };