const { Pool } = require("pg");

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });
}

let pool = createPool();

pool.on("error", (err) => {
  console.error("PG POOL ERROR:", err.message);
});

function shouldReconnect(err) {
  if (!err) return false;

  return (
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT" ||
    err.code === "57P01" ||
    err.message?.includes("Connection terminated unexpectedly") ||
    err.message?.includes("read ECONNRESET")
  );
}

async function reconnectPool() {
  try {
    await pool.end();
  } catch (e) {
    // ignore pool shutdown errors
  }

  pool = createPool();

  pool.on("error", (err) => {
    console.error("PG POOL ERROR:", err.message);
  });
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (shouldReconnect(err)) {
      console.error("DB connection reset. Recreating pool and retrying once...");
      await reconnectPool();
      return pool.query(text, params);
    }

    throw err;
  }
}

module.exports = {
  query,
  get pool() {
    return pool;
  },
};