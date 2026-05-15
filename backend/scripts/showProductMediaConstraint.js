require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const r = await c.query(`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'product_media'
      AND c.contype = 'c';
  `);

  console.log("product_media check constraints:");
  console.log(r.rows.map(x => x.def).join("\n\n"));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});