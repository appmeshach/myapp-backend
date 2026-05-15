require("dotenv").config();
const { Client } = require("pg");

const orderId = process.argv[2];

if (!orderId) {
  console.error("Usage: node scripts/backfillLedgerForOrder.js <order_id>");
  process.exit(1);
}

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // Load order
  const orderRes = await client.query("SELECT * FROM orders WHERE id=$1", [orderId]);
  if (orderRes.rowCount === 0) {
    console.error("Order not found:", orderId);
    process.exit(1);
  }
  const order = orderRes.rows[0];

  // Only backfill if SETTLED
  if (order.state !== "SETTLED") {
    console.error("Order is not SETTLED. Current state:", order.state);
    process.exit(1);
  }

  // Helper: check if entry exists
  async function hasEntry(type) {
    const r = await client.query(
      "SELECT 1 FROM ledger_entries WHERE order_id=$1 AND entry_type=$2 LIMIT 1",
      [orderId, type]
    );
    return r.rowCount > 0;
  }

  // Insert helper
  async function insert(type, amount) {
    await client.query(
      `INSERT INTO ledger_entries (order_id, entry_type, amount_kobo, currency)
       VALUES ($1, $2, $3, 'NGN')`,
      [orderId, type, amount]
    );
    console.log("Inserted:", type, amount);
  }

  // Backfill missing credits
  const sellerExists = await hasEntry("SELLER_CREDIT");
  const feeExists = await hasEntry("PLATFORM_FEE_CREDIT");

  if (!sellerExists) await insert("SELLER_CREDIT", Number(order.total_amount_kobo));
  if (!feeExists) await insert("PLATFORM_FEE_CREDIT", Number(order.platform_fee_kobo));

  console.log("Done backfill for", orderId);

  await client.end();
})().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});