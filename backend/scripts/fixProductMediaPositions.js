require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  // Get all media ordered by product, then position, then created_at
  const all = await c.query(`
    SELECT id, product_id, position, created_at
    FROM product_media
    ORDER BY product_id, position, created_at;
  `);

  // Build per-product used positions set
  const used = new Map(); // product_id -> Set(positions)
  const updates = [];

  for (const row of all.rows) {
    const pid = row.product_id;
    if (!used.has(pid)) used.set(pid, new Set());
    const set = used.get(pid);

    if (!set.has(row.position)) {
      set.add(row.position); // keep as-is
      continue;
    }

    // position already used: find next available
    let p = row.position;
    while (set.has(p)) p++;
    set.add(p);

    updates.push({ id: row.id, newPos: p });
  }

  if (updates.length === 0) {
    console.log("✅ No duplicates found. Nothing to fix.");
    await c.end();
    return;
  }

  console.log(`Found ${updates.length} rows needing position changes...`);

  // Apply updates
  for (const u of updates) {
    await c.query(`UPDATE product_media SET position = $1 WHERE id = $2`, [
      u.newPos,
      u.id,
    ]);
  }

  console.log("✅ Fixed duplicate positions. Updated rows:", updates.length);

  await c.end();
})().catch((e) => {
  console.error("❌ Fix error:", e);
  process.exit(1);
});