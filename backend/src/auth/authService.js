const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authRepo = require("./authRepo");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";

async function signup({ display_name, email, password, phone }) {
  if (!display_name || !email || !password) {
    return { error: "display_name, email, password required", status: 400 };
  }

  const existing = await authRepo.getUserByEmail(email);
  if (existing) {
    return { error: "Email already in use", status: 409 };
  }

  const password_hash = await bcrypt.hash(password, 10);

  const user = await authRepo.createUser({
    display_name,
    email,
    phone,
    password_hash,
  });

  const token = jwt.sign(
    { user_id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { user, token };
}

async function login({ email, password }) {
  if (!email || !password) {
    return { error: "email and password required", status: 400 };
  }

  const user = await authRepo.getUserByEmail(email);
  if (!user || !user.password_hash) {
    return { error: "Invalid credentials", status: 401 };
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return { error: "Invalid credentials", status: 401 };
  }

  const safeUser = await authRepo.getUserById(user.id);

  const token = jwt.sign(
    { user_id: safeUser.id, role: safeUser.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return { user: safeUser, token };
}

async function getMe(user_id) {
  const user = await authRepo.getUserById(user_id);
  if (!user) return { error: "User not found", status: 404 };
  return { user };
}

module.exports = { signup, login, getMe };