const { query } = require("../db");

module.exports = async function idempotency(req, res, next) {
  try {
    const key = req.header("Idempotency-Key");

    if (!key) return next(); // allow normal flow

    const user_id = req.auth?.user_id;
    const route = req.originalUrl;

    const existing = await query(
      `
      SELECT response_json
      FROM idempotency_keys
      WHERE key = $1
        AND user_id = $2
        AND route = $3
      LIMIT 1
      `,
      [key, user_id, route]
    );

    if (existing.rows.length) {
      return res.json(existing.rows[0].response_json);
    }

    // capture response
    const originalJson = res.json.bind(res);

    res.json = async (body) => {
      await query(
        `
        INSERT INTO idempotency_keys (key, user_id, route, response_json)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING
        `,
        [key, user_id, route, body]
      );

      return originalJson(body);
    };

    next();
  } catch (e) {
    next(e);
  }
};