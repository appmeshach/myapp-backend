require("dotenv").config();
console.log("MIGRATE SCRIPT STARTED");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL not set. Put it in your .env for local runs.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }, // Railway requires SSL
  });

  await client.connect();

  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log("Found migrations:", files);

  try {
    for (const f of files) {
      const full = path.join(migrationsDir, f);
      const sql = fs.readFileSync(full, "utf8");
      console.log(`\n▶ Running ${f}...`);
      await client.query(sql);
      console.log(`✅ Done ${f}`);
    }
    console.log("\n✅ All migrations ran successfully.");
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error("❌ Migration error:", e);
  process.exit(1);
});