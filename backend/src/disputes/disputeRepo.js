
const { query } = require("../db");

async function createDispute({ order_id, reason_code }) {
  const res = await query(
    `
    INSERT INTO disputes (order_id, reason_code)
    VALUES ($1, $2)
    RETURNING *;
    `,
    [order_id, reason_code]
  );
  return res.rows[0];
}

async function getDisputeByOrder(orderId) {
  const res = await query(`SELECT * FROM disputes WHERE order_id=$1`, [orderId]);
  return res.rows[0] || null;
}

async function resolveDispute({ order_id, status, decision, fault_attribution }) {
  const res = await query(
    `
    UPDATE disputes
    SET status=$2, decision=$3, fault_attribution=$4, resolved_at=now()
    WHERE order_id=$1
    RETURNING *;
    `,
    [order_id, status, decision, fault_attribution]
  );
  return res.rows[0] || null;
}

module.exports = { createDispute, getDisputeByOrder, resolveDispute };