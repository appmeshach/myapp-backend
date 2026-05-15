const { query } = require("../db");

async function createUser({
  role = "BUYER",
  display_name,
  phone,
  email,
  avatar_url = null,
  social_handle = null,
  social_handle_visible = false,
  password_hash,
}) {
  const res = await query(
    `
    INSERT INTO users (
      role,
      display_name,
      phone,
      email,
      avatar_url,
      social_handle,
      social_handle_visible,
      password_hash
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id, role, display_name, phone, email, avatar_url, social_handle, social_handle_visible, created_at;
    `,
    [
      role,
      display_name,
      phone || null,
      email,
      avatar_url,
      social_handle,
      social_handle_visible,
      password_hash,
    ]
  );

  return res.rows[0];
}

async function getUserByEmail(email) {
  const res = await query(
    `
    SELECT *
    FROM users
    WHERE email = $1
    LIMIT 1;
    `,
    [email]
  );

  return res.rows[0] || null;
}

async function getUserById(id) {
  const res = await query(
    `
    SELECT id, role, display_name, phone, email, avatar_url, social_handle, social_handle_visible, created_at
    FROM users
    WHERE id = $1
    LIMIT 1;
    `,
    [id]
  );

  return res.rows[0] || null;
}

module.exports = { createUser, getUserByEmail, getUserById };