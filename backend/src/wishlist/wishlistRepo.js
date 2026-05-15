const { query } = require("../db");

async function addWishlistItem({ user_id, product_id }) {
  const res = await query(
    `
    INSERT INTO wishlist_items (user_id, product_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, product_id) DO NOTHING
    RETURNING *;
    `,
    [user_id, product_id]
  );

  return res.rows[0] || null;
}

async function listWishlistItems(user_id) {
  const res = await query(
    `
    SELECT
      w.id,
      w.user_id,
      w.product_id,
      w.created_at,
      p.title,
      p.price_kobo,
      p.currency,
      p.store_id,
      p.image_urls
    FROM wishlist_items w
    JOIN products p ON p.id = w.product_id
    WHERE w.user_id = $1
    ORDER BY w.created_at DESC;
    `,
    [user_id]
  );

  return res.rows;
}

async function removeWishlistItem(id, user_id) {
  const res = await query(
    `
    DELETE FROM wishlist_items
    WHERE id = $1
      AND user_id = $2
    RETURNING *;
    `,
    [id, user_id]
  );

  return res.rows[0] || null;
}

module.exports = {
  addWishlistItem,
  listWishlistItems,
  removeWishlistItem,
};