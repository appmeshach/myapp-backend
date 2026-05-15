require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();

  const r = await c.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'stores'
    ORDER BY ordinal_position;
  `);

  console.log("stores columns:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});