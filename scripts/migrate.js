// Creates or updates the database schema.
// Uses the direct (unpooled) connection, as Neon recommends for schema changes.
//
//   npm run migrate       (reads DATABASE_URL_UNPOOLED, falling back to DATABASE_URL, from .env.local)
import { connect } from "../server/sql.js";
import { applySchema } from "../server/schema.js";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
if (!url) {
  console.error("No database URL found. Run `neon env pull` (or `neon deploy`) to create .env.local first.");
  process.exit(1);
}
const host = new URL(url).hostname;
const sql = await connect({ url });
await applySchema(sql);
const tables = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
console.log(`Schema is up to date on ${host}: ${tables.map((t) => t.table_name).join(", ")}`);
await sql.close();
