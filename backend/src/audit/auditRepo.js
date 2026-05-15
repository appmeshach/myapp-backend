const { query } = require("../db");

async function logEvent({
  actor_user_id = null,
  actor_role = null,
  action,
  entity_type,
  entity_id,
  meta = {},
}) {
  const res = await query(
    `
    INSERT INTO audit_logs (
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      meta
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
    `,
    [actor_user_id, actor_role, action, entity_type, entity_id, meta]
  );

  return res.rows[0];
}

async function listByEntity(entity_type, entity_id) {
  const res = await query(
    `
    SELECT *
    FROM audit_logs
    WHERE entity_type = $1
      AND entity_id = $2
    ORDER BY created_at ASC;
    `,
    [entity_type, entity_id]
  );

  return res.rows;
}

module.exports = { logEvent, listByEntity };