require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

(async () => {
  console.log("MIGRATE SCRIPT STARTED");

  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not set. Put it in your .env for local runs.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // 1) Ensure migrations table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log("Found migrations:", files);

  for (const f of files) {
    // 2) Skip if already applied
    const already = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [f]
    );
    if (already.rowCount > 0) {
      console.log(`↪ Skipping ${f} (already applied)`);
      continue;
    }

    const full = path.join(migrationsDir, f);
    const sql = fs.readFileSync(full, "utf8");

    console.log(`\n▶ Running ${f}...`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(filename) VALUES($1)",
        [f]
      );
      await client.query("COMMIT");
      console.log(`✅ Done ${f}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`❌ Migration error in ${f}:`, e.message);
      process.exit(1);
    }
  }

  console.log("\n✅ All migrations ran successfully.");
  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});