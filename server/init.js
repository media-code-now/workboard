// Connects to the database, makes sure the schema exists, and returns the store + accounts.
import { connect } from "./sql.js";
import { createStore } from "./store.js";
import { createAuth } from "./auth.js";
import { applySchema, schemaReady } from "./schema.js";

export async function init({ dataDir } = {}) {
  const sql = await connect({ dataDir });
  // Normally `npm run migrate` has already created the tables (over the direct
  // connection). This one-query check is a safety net for fresh databases.
  if (!(await schemaReady(sql))) await applySchema(sql);
  const store = createStore(sql);
  const auth = createAuth(sql);
  const admin = await auth.bootstrapAdmin();
  if (admin) console.log(`Created first admin account for ${admin.email} from INITIAL_ADMIN_EMAIL.`);
  return { sql, store, auth };
}
