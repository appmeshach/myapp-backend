const { query } = require("../db");

async function listStores() {
  const res = await query(
    `SELECT id, name, approval_status, created_at
     FROM stores
     WHERE approval_status = 'APPROVED'
     ORDER BY created_at DESC
     LIMIT 50`
  );
  return res.rows;
}

async function getStoreById(id) {
  const res = await query(
    `SELECT id, name, approval_status, created_at
     FROM stores
     WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

module.exports = { listStores, getStoreById };