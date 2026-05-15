const { query } = require("../db");

async function listCategories() {
  const res = await query(
    `
    SELECT
      category_group,
      COUNT(*)::int AS product_count
    FROM products
    WHERE is_active = true
      AND category_group IS NOT NULL
      AND category_group <> ''
    GROUP BY category_group
    ORDER BY category_group ASC;
    `
  );

  return res.rows;
}

async function listProductsByCategory(category_group, limit = 50) {
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
      AND p.category_group = $1
    ORDER BY p.created_at DESC
    LIMIT $2;
    `,
    [category_group, limit]
  );

  return res.rows;
}

module.exports = { listCategories, listProductsByCategory };