require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();

  console.log("Fixing users_role_check constraint...");

  await c.query(`
    ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;
  `);

  await c.query(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('BUYER','SELLER','OPS','ADMIN'));
  `);

  console.log("Constraint updated successfully.");

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});