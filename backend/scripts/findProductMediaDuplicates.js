require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const r = await c.query(`
    SELECT product_id, position, COUNT(*)::int AS n
    FROM product_media
    GROUP BY product_id, position
    HAVING COUNT(*) > 1
    ORDER BY n DESC;
  `);

  console.log("Duplicate product_media positions:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});