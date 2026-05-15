require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const orderId = process.argv[2];
  if (!orderId) {
    console.log("Usage: node scripts/forceExpire.js <order_id>");
    process.exit(1);
  }

  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();
  await c.query(
    `UPDATE orders SET inspection_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
    [orderId]
  );
  await c.end();
  console.log("✅ Forced inspection_expires_at to past for", orderId);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});