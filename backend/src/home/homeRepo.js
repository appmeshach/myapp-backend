const { query } = require("../db");

async function getFeaturedProducts(limit = 8) {
  const res = await query(
    `
    SELECT
      p.id,
      p.store_id,
      p.title,
      p.description,
p.brief_detail,
p.price_kobo,
      p.currency,
      p.image_urls,
      p.category_group,
      p.is_active,
      p.created_at,
      s.name AS store_name,
      LEFT(s.name, 6) AS store_name_short,
      COALESCE(p.image_urls->>0, '') AS primary_image_url
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return res.rows;
}

async function getLatestProducts(limit = 20) {
  const res = await query(
    `
    SELECT
      p.id,
      p.store_id,
      p.title,
      p.description,
      p.price_kobo,
      p.currency,
      p.image_urls,
      p.category_group,
      p.is_active,
      p.created_at,
      s.name AS store_name,
      LEFT(s.name, 6) AS store_name_short,
      COALESCE(p.image_urls->>0, '') AS primary_image_url
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return res.rows;
}

module.exports = { getFeaturedProducts, getLatestProducts };