// User accounts, cookie sessions and sign-in limits, stored in Postgres.
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { ValidationError } from "./store.js";

const scrypt = promisify(scryptCb);
const SESSION_DAYS = 30;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60000;
export const SESSION_COOKIE = "wb_session";

export const AUTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    created_at    FLOAT8 NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at FLOAT8 NOT NULL,
    created_at FLOAT8 NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS login_failures (
    key   TEXT PRIMARY KEY,
    first FLOAT8 NOT NULL,
    count INTEGER NOT NULL
  )`,
];

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(password, stored) {
  const [alg, salt, key] = String(stored).split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
export const generatePassword = () => randomBytes(12).toString("base64url");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e ?? "").trim().toLowerCase();
const publicUser = (r) => r && { id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at };
// Unknown emails take as long to reject as wrong passwords.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 10) throw new ValidationError("Password must be at least 10 characters");
  if (pw.length > 200) throw new ValidationError("Password is too long");
}

/** @param {import("./sql.js").Sql} sql */
export function createAuth(sql) {
  const one = async (text, params) => (await sql.query(text, params))[0];

  const auth = {
    async userCount() { return Number((await one("SELECT COUNT(*)::int AS n FROM users")).n); },
    async listUsers() { return (await sql.query("SELECT * FROM users ORDER BY created_at")).map(publicUser); },
    async getUser(id) { return publicUser(await one("SELECT * FROM users WHERE id = $1", [id])); },
    async getUserByEmail(email) { return publicUser(await one("SELECT * FROM users WHERE email = $1", [normEmail(email)])); },

    async createUser({ email, name, password, role = "member" }) {
      email = normEmail(email);
      name = String(name ?? "").trim();
      if (!EMAIL_RE.test(email)) throw new ValidationError("Enter a valid email address");
      if (!name) throw new ValidationError("Name is required");
      if (name.length > 80) throw new ValidationError("Name must be at most 80 characters");
      if (!["admin", "member"].includes(role)) throw new ValidationError("Role must be admin or member");
      checkPassword(password);
      if (await one("SELECT 1 FROM users WHERE email = $1", [email])) throw new ValidationError("A user with that email already exists");
      const row = await one(
        "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [randomUUID(), email, name, await hashPassword(password), role, Date.now()]);
      return publicUser(row);
    },
    /** Sets a password. Signs the user out everywhere except `keepToken` (the current session, if any). */
    async setPassword(userId, password, keepToken) {
      checkPassword(password);
      await sql.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(password), userId]);
      await sql.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [userId, keepToken ? sha256(keepToken) : ""]);
    },
    async changeOwnPassword(userId, current, next, keepToken) {
      const row = await one("SELECT password_hash FROM users WHERE id = $1", [userId]);
      if (!row || !(await verifyPassword(String(current ?? ""), row.password_hash))) throw new ValidationError("Your current password is incorrect");
      await this.setPassword(userId, next, keepToken);
    },
    async removeUser(userId) { return (await sql.query("DELETE FROM users WHERE id = $1 RETURNING id", [userId])).length > 0; },
    async adminCount() { return Number((await one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'")).n); },

    async authenticate(email, password) {
      const row = await one("SELECT * FROM users WHERE email = $1", [normEmail(email)]);
      const ok = await verifyPassword(String(password ?? ""), row?.password_hash ?? DUMMY_HASH);
      return ok && row ? publicUser(row) : null;
    },

    async startSession(userId) {
      const token = randomBytes(32).toString("base64url");
      const now = Date.now();
      await sql.query("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4)",
        [sha256(token), userId, now + SESSION_DAYS * 86400000, now]);
      await sql.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
      return { token, maxAgeMs: SESSION_DAYS * 86400000 };
    },
    async userForToken(token) {
      if (!token) return null;
      return publicUser(await one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2",
        [sha256(token), Date.now()]));
    },
    async endSession(token) { if (token) await sql.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]); },

    // ---- sign-in limits (kept in the database so every server instance shares them) ----
    async blockedFor(ip, email) {
      const r = await one("SELECT first, count FROM login_failures WHERE key = $1", [`${ip}|${normEmail(email)}`]);
      if (!r || Date.now() - r.first > LOGIN_WINDOW_MS || r.count < LOGIN_MAX_FAILURES) return 0;
      return Math.ceil((r.first + LOGIN_WINDOW_MS - Date.now()) / 1000);
    },
    async recordFailure(ip, email) {
      const now = Date.now();
      await sql.query(
        `INSERT INTO login_failures (key, first, count) VALUES ($1, $2, 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN $2 - login_failures.first > $3 THEN 1 ELSE login_failures.count + 1 END,
           first = CASE WHEN $2 - login_failures.first > $3 THEN $2 ELSE login_failures.first END`,
        [`${ip}|${normEmail(email)}`, now, LOGIN_WINDOW_MS]);
      await sql.query("DELETE FROM login_failures WHERE first < $1", [now - LOGIN_WINDOW_MS]);
    },
    async clearFailures(ip, email) { await sql.query("DELETE FROM login_failures WHERE key = $1", [`${ip}|${normEmail(email)}`]); },

    /** Creates the first admin from INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD when there are no users yet. */
    async bootstrapAdmin(env = process.env) {
      if (!env.INITIAL_ADMIN_EMAIL || !env.INITIAL_ADMIN_PASSWORD) return null;
      if ((await this.userCount()) > 0) return null;
      try {
        return await this.createUser({ email: env.INITIAL_ADMIN_EMAIL, name: env.INITIAL_ADMIN_NAME || "Admin", password: env.INITIAL_ADMIN_PASSWORD, role: "admin" });
      } catch (e) {
        if (e instanceof ValidationError && /already exists/.test(e.message)) return null; // another instance won the race
        throw e;
      }
    },
  };
  return auth;
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return out;
}
