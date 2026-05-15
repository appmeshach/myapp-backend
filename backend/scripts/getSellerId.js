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
    SELECT id, email, role
    FROM users
    WHERE email = $1
    `,
    ["meshach.seller@example.com"]
  );

  console.log("seller:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});