import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3001;
const DB_FILE = resolve(process.env.DATABASE_FILE || join(root, "data", "workboard.db"));

const store = openDb(DB_FILE);
const auth = createAuth(store.raw);
const app = createApp(store, auth, {
  staticDir: process.env.NODE_ENV === "production" ? join(root, "dist") : null,
  secureCookies: process.env.SECURE_COOKIES === "true",
});
// Behind a reverse proxy (nginx, Fly, Railway...), trust it for the client IP used in sign-in limits.
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);

const server = app.listen(PORT, () => {
  console.log(`Workboard API listening on http://localhost:${PORT} (database: ${DB_FILE})`);
  if (auth.userCount() === 0) console.log('No users yet. Create the first one with: npm run user -- add --email you@company.com --name "Your Name" --admin');
});

function shutdown() {
  app.locals.closeStreams();
  server.close(() => { store.close(); process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
