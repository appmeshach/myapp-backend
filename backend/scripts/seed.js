require("dotenv").config();
const { Client } = require("pg");

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing in .env");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // Create buyer
  const buyerRes = await client.query(
    `
    INSERT INTO users (role, display_name, phone, email)
    VALUES ('BUYER', 'Test Buyer', '08000000000', 'buyer@test.local')
    RETURNING id;
    `
  );

  // Create seller
  const sellerRes = await client.query(
    `
    INSERT INTO users (role, display_name, phone, email)
    VALUES ('SELLER', 'Test Seller', '08111111111', 'seller@test.local')
    RETURNING id;
    `
  );

  const buyerId = buyerRes.rows[0].id;
  const sellerId = sellerRes.rows[0].id;

  // Create store owned by seller
  const storeRes = await client.query(
    `
    INSERT INTO stores (owner_user_id, name, state, approval_status, rep_photo_url, logo_url)
    VALUES ($1, 'Test Store', 'Lagos', 'APPROVED',
            'https://example.com/rep.jpg',
            'https://example.com/logo.jpg')
    RETURNING id;
    `,
    [sellerId]
  );

  const storeId = storeRes.rows[0].id;

  console.log("✅ Seed complete");
  console.log("Buyer ID :", buyerId);
  console.log("Seller ID:", sellerId);
  console.log("Store ID :", storeId);

  await client.end();
})().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});