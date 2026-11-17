// Postgres connection.
//
// Production (Netlify) and any real database: Neon's serverless driver over HTTP,
// which suits short-lived serverless functions (no connection to keep open).
// It uses the pooled DATABASE_URL from `neon env pull` / `neon deploy`; the older
// NETLIFY_DATABASE_URL from Netlify DB is still accepted.
//
// Local development and tests without a database URL: embedded Postgres (PGlite).

/**
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<any[]>, close: () => Promise<void> }} Sql
 */

/** Hides passwords and connection strings so errors can be shown or logged safely. */
export function redactSecrets(text) {
  return String(text ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://***")
    .replace(/npg_[A-Za-z0-9]+/g, "***");
}

/**
 * Accepts a connection string pasted in common forms (with a leading `psql`, surrounding
 * quotes, or stray spaces) and returns the bare postgresql:// URL.
 */
export function cleanDatabaseUrl(raw) {
  let v = String(raw ?? "").trim();
  if (!v) return "";
  v = v.replace(/^psql\s+/i, "").trim().replace(/^(['"])(.*)\1$/s, "$2").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(v)) {
    throw new Error("DATABASE_URL isn't a Postgres connection string. It should start with postgresql:// (copy it from Neon > Connect).");
  }
  try { new URL(v); } catch {
    throw new Error("DATABASE_URL couldn't be read as a URL. Copy the connection string from Neon > Connect again.");
  }
  return v;
}

export const databaseUrl = (env = process.env) => cleanDatabaseUrl(env.DATABASE_URL || env.NETLIFY_DATABASE_URL || "");

/** @returns {Promise<Sql>} */
export async function connect({ dataDir, url = databaseUrl() } = {}) {
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(cleanDatabaseUrl(url));
    // `sql.query(text, params)` runs one parameterized statement and returns its rows.
    // Errors are re-thrown without the connection string the driver may include.
    const query = async (text, params = []) => {
      try { return await sql.query(text, params); }
      catch (e) {
        if (/password authentication failed/i.test(e?.message)) {
          throw new Error("The database rejected the password in DATABASE_URL. Copy the current connection string from Neon > Connect.");
        }
        e.message = redactSecrets(e.message);
        throw e;
      }
    };
    return { query, close: async () => {} };
  }
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) {
    throw new Error("No database configured. Set DATABASE_URL (your Neon pooled connection string) in Netlify's environment variables, then redeploy.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows,
    close: () => db.close(),
  };
}
