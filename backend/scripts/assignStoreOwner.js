require("dotenv").config();
const { Client } = require("pg");

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await c.connect();

  const storeId = "ee1a0ecb-44de-4463-8912-749dbe056b61";
  const newOwnerUserId = "2931744f-1fea-47eb-b49a-401e209d131b";

  const r = await c.query(
    `
    UPDATE stores
    SET owner_user_id = $2
    WHERE id = $1
    RETURNING id, owner_user_id, name;
    `,
    [storeId, newOwnerUserId]
  );

  console.log("updated store owner:");
  console.table(r.rows);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});