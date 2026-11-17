import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3001;
const DB_FILE = resolve(process.env.DATABASE_FILE || join(root, "data", "workboard.db"));

const store = openDb(DB_FILE);
const app = createApp(store, {
  staticDir: process.env.NODE_ENV === "production" ? join(root, "dist") : null,
  auth: { user: process.env.APP_USER, password: process.env.APP_PASSWORD },
});

const server = app.listen(PORT, () => {
  console.log(`Workboard API listening on http://localhost:${PORT} (database: ${DB_FILE})`);
});

function shutdown() {
  app.locals.closeStreams();
  server.close(() => { store.close(); process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
