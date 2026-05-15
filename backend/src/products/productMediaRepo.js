const { query } = require("../db");

async function addMedia({ product_id, media_type, storage_key, position = 0 }) {
  const res = await query(
    `
    INSERT INTO product_media (product_id, media_type, storage_key, position)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
    `,
    [product_id, media_type, storage_key, position]
  );

  return res.rows[0];
}

async function listMedia(productId) {
  const res = await query(
    `
    SELECT *
    FROM product_media
    WHERE product_id = $1
    ORDER BY position ASC, created_at ASC;
    `,
    [productId]
  );

  return res.rows;
}

module.exports = { addMedia, listMedia };