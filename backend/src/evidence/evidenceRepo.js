const { query } = require("../db");

async function insertEvidence({ order_id, uploaded_by, media_type, storage_key }) {
  const res = await query(
    `
    INSERT INTO order_evidence (order_id, uploaded_by, media_type, storage_key)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
    `,
    [order_id, uploaded_by, media_type, storage_key]
  );
  return res.rows[0];
}

async function listEvidence(orderId) {
  const res = await query(
    `
    SELECT *
    FROM order_evidence
    WHERE order_id = $1
    ORDER BY created_at ASC;
    `,
    [orderId]
  );
  return res.rows;
}

module.exports = { insertEvidence, listEvidence };