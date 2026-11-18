// Simple JSON document storage for the Leads module (Lead Desk), which keeps
// leads, proposals and its settings as documents in a few named collections.
import { ValidationError } from "./store.js";

export const DOC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       JSONB NOT NULL,
    updated_at FLOAT8 NOT NULL,
    PRIMARY KEY (collection, id)
  )`,
];

export const COLLECTIONS = ["leads", "proposals", "config"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DOC_BYTES = 200 * 1024;

function check(collection, id) {
  if (!COLLECTIONS.includes(collection)) throw new ValidationError("Unknown collection");
  if (id !== undefined && !ID_RE.test(id)) throw new ValidationError("Invalid document id");
}

/** @param {import("./sql.js").Sql} sql */
export function createDocuments(sql) {
  const bump = () => sql.query("UPDATE meta SET value = value + 1 WHERE key = 'rev'");
  return {
    async get(collection, id) {
      check(collection, id);
      const [r] = await sql.query("SELECT data FROM documents WHERE collection = $1 AND id = $2", [collection, id]);
      return r ? (typeof r.data === "string" ? JSON.parse(r.data) : r.data) : null;
    },
    async list(collection) {
      check(collection);
      const rows = await sql.query("SELECT id, data FROM documents WHERE collection = $1 ORDER BY updated_at", [collection]);
      return rows.map((r) => ({ id: r.id, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data }));
    },
    async set(collection, id, data) {
      check(collection, id);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("A document must be an object");
      const json = JSON.stringify(data);
      if (json.length > MAX_DOC_BYTES) throw new ValidationError("That record is too large to save");
      await sql.query(
        `INSERT INTO documents (collection, id, data, updated_at) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [collection, id, json, Date.now()]);
      await bump();
    },
    async remove(collection, id) {
      check(collection, id);
      const gone = (await sql.query("DELETE FROM documents WHERE collection = $1 AND id = $2 RETURNING id", [collection, id])).length > 0;
      if (gone) await bump();
      return gone;
    },
  };
}
