require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // Use the store id you already have
  const storeId = "ee1a0ecb-44de-4463-8912-749dbe056b61";

  // Insert ONE product (matches your real columns)
  const insert = await client.query(
    `
    INSERT INTO products (
      store_id, title, description, price_kobo, currency, category_group, is_active, image_urls
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *;
    `,
    [
      storeId,
      "Test Product 1",
      "This is a seeded product for discovery testing",
      30000,
      "NGN",
      "STATIC_GOODS",
      true,
      JSON.stringify([
        "https://picsum.photos/seed/test-product-1/600/600",
        "https://picsum.photos/seed/test-product-1b/600/600",
      ]),
    ]
  );

  console.log("✅ Seeded product:", insert.rows[0].id);

  const count = await client.query("select count(*)::int as n from products");
  console.log("Total products now:", count.rows[0].n);

  await client.end();
})().catch((e) => {
  console.error("❌ SeedProducts error:", e);
  process.exit(1);
});