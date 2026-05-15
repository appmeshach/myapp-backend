const { query } = require("../db");

async function addOrderItem({
  order_id,
  product_id,
  variant_id,
  qty,
  unit_price_kobo,
  line_total_kobo,
}) {
  const res = await query(
    `
    INSERT INTO order_items (
      order_id,
      product_id,
      variant_id,
      qty,
      unit_price_kobo,
      line_total_kobo
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
    `,
    [order_id, product_id, variant_id || null, qty, unit_price_kobo, line_total_kobo]
  );

  return res.rows[0];
}

async function listOrderItems(orderId) {
  const res = await query(
    `
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.variant_id,
      oi.qty,
      oi.unit_price_kobo,
      oi.line_total_kobo,
      oi.created_at,
      p.title,
      v.option_label AS variant_label
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants v ON v.id = oi.variant_id
    WHERE oi.order_id = $1
    ORDER BY oi.created_at ASC;
    `,
    [orderId]
  );

  return res.rows;
}

module.exports = { addOrderItem, listOrderItems };