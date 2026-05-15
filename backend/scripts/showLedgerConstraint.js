require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const r = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'ledger_entries'
      AND c.contype = 'c';
  `);

  console.log(r.rows);

  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});