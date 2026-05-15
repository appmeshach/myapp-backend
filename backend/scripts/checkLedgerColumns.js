require("dotenv").config();
const { Client } = require("pg");

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing in .env");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const r = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name='ledger_entries'
    ORDER BY ordinal_position;
  `);

  console.log("ledger_entries columns:");
  console.log(r.rows);

  await client.end();
})().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});