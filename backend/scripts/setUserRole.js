require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();

  const email = process.argv[2];
  const role = process.argv[3];

  if (!email || !role) {
    console.log("Usage: node scripts/setUserRole.js <email> <role>");
    process.exit(1);
  }

  const r = await c.query(
    `
    UPDATE users
    SET role = $2
    WHERE email = $1
    RETURNING id, email, role, display_name;
    `,
    [email, role]
  );

  console.log("updated user:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});