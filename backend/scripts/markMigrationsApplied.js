require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  // Mark these as already applied (we know your DB already has their tables)
  const already = [
    "001_core.sql",
    "002_store_product.sql",
    "003_orders_ledger.sql",
    "005_evidence_disputes.sql",
  ];

  for (const f of already) {
    await c.query(
      `INSERT INTO schema_migrations(filename)
       VALUES($1)
       ON CONFLICT (filename) DO NOTHING;`,
      [f]
    );
  }

  console.log("✅ Marked as applied:", already);

  const r = await c.query(
    `SELECT filename, applied_at FROM schema_migrations ORDER BY filename;`
  );
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});