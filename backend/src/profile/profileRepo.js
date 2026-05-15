const { query } = require("../db");

async function listBuyerOrders(user_id) {
  const res = await query(
    `
    SELECT
      o.id,
      o.buyer_user_id,
      o.store_id,
      o.state,
      o.item_count,
      o.total_amount_kobo,
      o.delivery_fee_kobo,
      o.platform_fee_kobo,
      o.created_at,
      s.name AS store_name
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    WHERE o.buyer_user_id = $1
    ORDER BY o.created_at DESC;
    `,
    [user_id]
  );

  return res.rows;
}

async function getBuyerOrder(orderId, user_id) {
  const orderRes = await query(
    `
    SELECT
      o.id,
      o.buyer_user_id,
      o.store_id,
      o.state,
      o.item_count,
      o.total_amount_kobo,
      o.delivery_fee_kobo,
      o.platform_fee_kobo,
      o.created_at,
      s.name AS store_name
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    WHERE o.id = $1
      AND o.buyer_user_id = $2
    LIMIT 1;
    `,
    [orderId, user_id]
  );

  const order = orderRes.rows[0] || null;
  if (!order) return null;

  const itemsRes = await query(
    `
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.variant_id,
      oi.qty,
      oi.unit_price_kobo,
      oi.line_total_kobo,
      p.title,
      LEFT(s.name, 6) AS store_name_short,
      COALESCE(p.image_urls->>0, '') AS primary_image_url,
      v.option_label AS variant_label
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    JOIN stores s ON s.id = o.store_id
    LEFT JOIN product_variants v ON v.id = oi.variant_id
    WHERE oi.order_id = $1
    ORDER BY oi.created_at ASC;
    `,
    [orderId]
  );

  return {
    order,
    items: itemsRes.rows,
  };
}

module.exports = { listBuyerOrders, getBuyerOrder };