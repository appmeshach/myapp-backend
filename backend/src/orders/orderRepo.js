const { query } = require("../db");

async function createOrder({
  buyer_user_id,
  store_id,
  item_count,
  total_amount_kobo,
  delivery_fee_kobo,
  platform_fee_kobo,
}) {
  const res = await query(
    `
    INSERT INTO orders (
      buyer_user_id, store_id, state, item_count,
      total_amount_kobo, delivery_fee_kobo, platform_fee_kobo
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *;
    `,
    [
      buyer_user_id,
      store_id,
      "ESCROW_LOCKED",
      item_count,
      total_amount_kobo,
      delivery_fee_kobo,
      platform_fee_kobo,
    ]
  );
  return res.rows[0];
}
async function createPendingPaymentOrder({
  buyer_user_id,
  store_id,
  item_count,
  total_amount_kobo,
  delivery_fee_kobo,
  platform_fee_kobo,
}) {
  const res = await query(
    `
    INSERT INTO orders (
      buyer_user_id, store_id, state, item_count,
      total_amount_kobo, delivery_fee_kobo, platform_fee_kobo
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *;
    `,
    [
      buyer_user_id,
      store_id,
      "PENDING_PAYMENT",
      item_count,
      total_amount_kobo,
      delivery_fee_kobo,
      platform_fee_kobo,
    ]
  );
  return res.rows[0];
}
async function settleIfStillInspectionActive(orderId) {
  const res = await query(
    `
    UPDATE orders
    SET state = 'SETTLED'
    WHERE id = $1
      AND state = 'INSPECTION_ACTIVE'
    RETURNING *;
    `,
    [orderId]
  );

  return res.rows[0] || null; // null means someone else already changed state
}

async function getOrderById(id) {
  const res = await query(`SELECT * FROM orders WHERE id=$1`, [id]);
  return res.rows[0] || null;
}
const getById = getOrderById;

async function updateOrderState(id, newState, patch = {}) {
  const fields = [];
  const values = [];
  let i = 1;

  fields.push(`state = $${i++}`);
  values.push(newState);

  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }

  values.push(id);

  const res = await query(
    `UPDATE orders SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );

  return res.rows[0];
}
const updateState = updateOrderState;
async function listExpiredInspectionOrders() {
  const res = await query(
    `
    SELECT *
    FROM orders
    WHERE state = 'INSPECTION_ACTIVE'
      AND inspection_expires_at IS NOT NULL
      AND inspection_expires_at <= NOW()
    ORDER BY inspection_expires_at ASC;
    `
  );
  return res.rows;
}

module.exports = {
  createOrder,
  getOrderById,
  updateOrderState,
  getById,
  updateState,
  listExpiredInspectionOrders,
  settleIfStillInspectionActive, 
  createPendingPaymentOrder,
};