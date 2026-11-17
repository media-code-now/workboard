// User accounts and cookie sessions.
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { ValidationError } from "./db.js";

const scrypt = promisify(scryptCb);
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "wb_session";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;

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
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (r) => r && { id: r.id, email: r.email, name: r.name, role: r.role };

// A fixed hash so unknown emails take as long to reject as wrong passwords.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export function createAuth(db) {
  db.exec(SCHEMA);
  const q = {
    byEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    byId: db.prepare("SELECT * FROM users WHERE id = ?"),
    list: db.prepare("SELECT * FROM users ORDER BY created_at"),
    count: db.prepare("SELECT COUNT(*) AS n FROM users"),
    insert: db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    setPassword: db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
    remove: db.prepare("DELETE FROM users WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"),
    sessionUser: db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    purge: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  };

  function checkPassword(pw) {
    if (typeof pw !== "string" || pw.length < 10) throw new ValidationError("Password must be at least 10 characters");
    if (pw.length > 200) throw new ValidationError("Password is too long");
  }

  return {
    userCount: () => q.count.get().n,
    listUsers: () => q.list.all().map(publicUser),
    getUserByEmail: (email) => publicUser(q.byEmail.get(String(email).trim().toLowerCase())),

    async createUser({ email, name, password, role = "member" }) {
      email = String(email ?? "").trim().toLowerCase();
      name = String(name ?? "").trim();
      if (!EMAIL_RE.test(email)) throw new ValidationError("Enter a valid email address");
      if (!name) throw new ValidationError("Name is required");
      if (!["admin", "member"].includes(role)) throw new ValidationError("Role must be admin or member");
      checkPassword(password);
      if (q.byEmail.get(email)) throw new ValidationError("A user with that email already exists");
      const id = randomUUID();
      q.insert.run(id, email, name.slice(0, 80), await hashPassword(password), role, Date.now());
      return publicUser(q.byId.get(id));
    },
    async setPassword(userId, password) {
      checkPassword(password);
      q.setPassword.run(await hashPassword(password), userId);
      q.deleteUserSessions.run(userId); // sign out everywhere
    },
    removeUser: (userId) => q.remove.run(userId).changes > 0,

    /** Returns the user when the email/password pair is right, otherwise null. */
    async authenticate(email, password) {
      const row = q.byEmail.get(String(email ?? "").trim().toLowerCase());
      const ok = await verifyPassword(String(password ?? ""), row?.password_hash ?? DUMMY_HASH);
      return ok && row ? publicUser(row) : null;
    },

    startSession(userId) {
      const token = randomBytes(32).toString("base64url");
      const expires = Date.now() + SESSION_DAYS * 86400000;
      q.insertSession.run(sha256(token), userId, expires, Date.now());
      q.purge.run(Date.now());
      return { token, maxAgeMs: SESSION_DAYS * 86400000 };
    },
    userForToken: (token) => (token ? publicUser(q.sessionUser.get(sha256(token), Date.now())) : null),
    endSession: (token) => { if (token) q.deleteSession.run(sha256(token)); },
  };
}

/** Very small in-memory limiter for failed sign-ins: 5 failures per 15 minutes per IP + email. */
export function createLoginLimiter({ max = 5, windowMs = 15 * 60000 } = {}) {
  const hits = new Map();
  const key = (ip, email) => `${ip}|${String(email ?? "").trim().toLowerCase()}`;
  return {
    blockedFor(ip, email) {
      const h = hits.get(key(ip, email));
      if (!h || Date.now() - h.first > windowMs) return 0;
      return h.count >= max ? Math.ceil((h.first + windowMs - Date.now()) / 1000) : 0;
    },
    fail(ip, email) {
      const k = key(ip, email), h = hits.get(k);
      if (!h || Date.now() - h.first > windowMs) hits.set(k, { first: Date.now(), count: 1 });
      else h.count++;
      if (hits.size > 10000) hits.clear();
    },
    reset(ip, email) { hits.delete(key(ip, email)); },
  };
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
