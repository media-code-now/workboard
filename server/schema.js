// Applies the schema. Every statement is idempotent (IF NOT EXISTS / ON CONFLICT),
// so running it again is safe. Bump SCHEMA_VERSION whenever a statement is added,
// so existing databases pick it up on the next start or `npm run migrate`.
import { SCHEMA } from "./store.js";
import { AUTH_SCHEMA } from "./auth.js";
import { NOTIFY_SCHEMA } from "./notifications.js";
import { DOC_SCHEMA } from "./documents.js";

export const SCHEMA_VERSION = 4; // 2: notifications + prefs; 3: documents (Leads); 4: notification links, task creator, digest log

export async function applySchema(sql) {
  for (const stmt of [...SCHEMA, ...AUTH_SCHEMA, ...NOTIFY_SCHEMA, ...DOC_SCHEMA]) await sql.query(stmt);
  await sql.query(
    "INSERT INTO meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [SCHEMA_VERSION]);
}

export async function schemaReady(sql) {
  const [{ exists } = {}] = await sql.query("SELECT to_regclass('public.meta') IS NOT NULL AS exists");
  if (!exists) return false;
  const [r] = await sql.query("SELECT value FROM meta WHERE key = 'schema_version'");
  return Number(r?.value ?? 0) >= SCHEMA_VERSION;
}
