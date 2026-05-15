require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const r = await c.query(`
    select column_name, data_type
    from information_schema.columns
    where table_name = 'products'
    order by ordinal_position
  `);

  console.log("products columns:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});