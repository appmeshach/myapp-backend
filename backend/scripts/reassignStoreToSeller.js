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
    UPDATE stores
    SET owner_user_id = $1
    WHERE name = 'Test Store'
    RETURNING id, owner_user_id, name;
    `,
    ["9d582525-95f2-4a17-97ba-53307ad0d513"]
  );

  console.log("updated store:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});