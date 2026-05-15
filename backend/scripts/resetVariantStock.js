require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();

  const r = await c.query(
    `
    UPDATE product_variants
    SET stock_qty = 20
    WHERE option_label = $1
    RETURNING id, option_label, stock_qty;
    `,
    ["Small / Black"]
  );

  console.log("updated variants:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});