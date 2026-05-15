const { query } = require("../db");

async function searchProducts({ q, store_id }) {
  const values = [];
  let i = 1;

  let sql = `
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
  `;

  if (q) {
    sql += ` AND (p.title ILIKE $${i} OR p.description ILIKE $${i})`;
    values.push(`%${q}%`);
    i++;
  }

  if (store_id) {
    sql += ` AND p.store_id = $${i}`;
    values.push(store_id);
    i++;
  }

  sql += `
    ORDER BY p.created_at DESC
    LIMIT 50
  `;

  const res = await query(sql, values);
  return res.rows;
}

async function suggestProducts(q) {
  const like = `%${q}%`;

  const res = await query(
    `
    SELECT DISTINCT title
    FROM products
    WHERE is_active = true
      AND title ILIKE $1
    ORDER BY title ASC
    LIMIT 10
    `,
    [like]
  );

  return res.rows.map((r) => r.title);
}

module.exports = { searchProducts, suggestProducts };