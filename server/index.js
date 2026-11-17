// Local / self-hosted server. On Netlify, netlify/functions/api.mjs is used instead.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { init } from "./init.js";
import { createApp } from "./app.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = resolve(process.env.DATA_DIR || join(root, "data", "pg"));

const { sql, store, auth } = await init({ dataDir: DATA_DIR });
const app = createApp(store, auth, {
  staticDir: process.env.NODE_ENV === "production" ? join(root, "dist") : null,
  secureCookies: process.env.SECURE_COOKIES === "true",
});
// Behind a reverse proxy (nginx, Caddy...), trust it for the client IP used in sign-in limits.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);

const where = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL ? "Netlify DB / Postgres" : DATA_DIR;
const server = app.listen(PORT, async () => {
  console.log(`Workboard API listening on http://localhost:${PORT} (database: ${where})`);
  if ((await auth.userCount()) === 0) {
    console.log('No users yet. Create the first one with: npm run user -- add --email you@company.com --name "Your Name" --admin');
  }
});

function shutdown() {
  server.close(async () => { await sql.close(); process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
