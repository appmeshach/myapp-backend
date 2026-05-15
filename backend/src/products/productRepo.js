const { query } = require("../db");

async function getProductById(id) {
  console.log("USING UPDATED getProductById");
  const res = await query(
    `
    SELECT 
      p.*,
      s.name AS store_name
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.id = $1
    `,
    [id]
  );

  return res.rows[0];
}

async function listProductMedia(productId) {
  // This table name depends on your 006_discovery.sql.
  // If your table is named product_media, this will work.
  const res = await query(
    `
    SELECT *
    FROM product_media
    WHERE product_id = $1
    ORDER BY created_at ASC;
    `,
    [productId]
  );
  return res.rows;
}
async function listProducts(limit = 50) {
  const res = await query(
    `
    SELECT *
    FROM products
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return res.rows;
}

async function listProductsByStore(storeId, limit = 50) {
  const res = await query(
    `
    SELECT *
    FROM products
    WHERE store_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [storeId, limit]
  );
  return res.rows;
}

module.exports = { getProductById, listProductMedia, listProducts, listProductsByStore };