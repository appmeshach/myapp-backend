const { query } = require("../db");

// Insert one ledger entry (append-only)
async function insertEntry({ order_id, entry_type, amount_kobo, currency = "NGN" }) {
  const res = await query(
    `
    INSERT INTO ledger_entries (order_id, entry_type, amount_kobo, currency)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
    `,
    [order_id, entry_type, amount_kobo, currency]
  );
  return res.rows[0];
}

// Read ledger for an order (read-only)
async function listEntriesByOrder(orderId) {
  const res = await query(
    `
    SELECT *
    FROM ledger_entries
    WHERE order_id = $1
    ORDER BY created_at ASC;
    `,
    [orderId]
  );
  return res.rows;
}

// Check whether a specific entry_type exists for an order (for idempotency)
async function hasEntry(orderId, entryType) {
  const res = await query(
    `
    SELECT 1
    FROM ledger_entries
    WHERE order_id = $1 AND entry_type = $2
    LIMIT 1;
    `,
    [orderId, entryType]
  );
  return res.rowCount > 0;
}

module.exports = { insertEntry, listEntriesByOrder, hasEntry };