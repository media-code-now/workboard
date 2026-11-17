// Connects to the database, creates tables, and returns the store + accounts.
import { connect } from "./sql.js";
import { SCHEMA, createStore } from "./store.js";
import { AUTH_SCHEMA, createAuth } from "./auth.js";

export async function init({ dataDir } = {}) {
  const sql = await connect({ dataDir });
  for (const stmt of [...SCHEMA, ...AUTH_SCHEMA]) await sql.query(stmt);
  const store = createStore(sql);
  const auth = createAuth(sql);
  const admin = await auth.bootstrapAdmin();
  if (admin) console.log(`Created first admin account for ${admin.email} from INITIAL_ADMIN_EMAIL.`);
  return { sql, store, auth };
}
