// Applies the schema. Every statement is idempotent (IF NOT EXISTS / ON CONFLICT),
// so running it again is safe.
import { SCHEMA } from "./store.js";
import { AUTH_SCHEMA } from "./auth.js";

export async function applySchema(sql) {
  for (const stmt of [...SCHEMA, ...AUTH_SCHEMA]) await sql.query(stmt);
}

export async function schemaReady(sql) {
  // login_failures is created last, so if it exists the schema is in place.
  const [{ ready } = {}] = await sql.query("SELECT to_regclass('public.login_failures') IS NOT NULL AS ready");
  return Boolean(ready);
}
