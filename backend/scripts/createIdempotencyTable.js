require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();

  await c.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL,
      user_id UUID NOT NULL,
      route TEXT NOT NULL,
      response_json JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(key, user_id, route)
    );
  `);

  console.log("idempotency_keys table ready");

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});