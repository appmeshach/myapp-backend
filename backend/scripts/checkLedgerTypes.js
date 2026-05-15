require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const r = await c.query(`
    SELECT entry_type, COUNT(*) as n
    FROM ledger_entries
    GROUP BY entry_type
    ORDER BY entry_type;
  `);

  console.log("Ledger entry_type counts:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});