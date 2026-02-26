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

  const res = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname='public'
    ORDER BY tablename;
  `);

  console.log("Tables:", res.rows.map(r => r.tablename));

  await client.end();
})().catch((e) => {
  console.error("Check failed:", e);
  process.exit(1);
});