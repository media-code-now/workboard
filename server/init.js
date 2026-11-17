// Connects to the database, creates tables if needed, and returns the store + accounts.
import { connect } from "./sql.js";
import { SCHEMA, createStore } from "./store.js";
import { AUTH_SCHEMA, createAuth } from "./auth.js";

export async function init({ dataDir } = {}) {
  const sql = await connect({ dataDir });
  // One quick check instead of ~10 statements on every cold start: the last table
  // created is login_failures, so if it exists the schema is in place.
  const [{ ready } = {}] = await sql.query("SELECT to_regclass('public.login_failures') IS NOT NULL AS ready");
  if (!ready) {
    for (const stmt of [...SCHEMA, ...AUTH_SCHEMA]) await sql.query(stmt);
  }
  const store = createStore(sql);
  const auth = createAuth(sql);
  const admin = await auth.bootstrapAdmin();
  if (admin) console.log(`Created first admin account for ${admin.email} from INITIAL_ADMIN_EMAIL.`);
  return { sql, store, auth };
}
