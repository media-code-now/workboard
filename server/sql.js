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

export const databaseUrl = (env = process.env) => env.DATABASE_URL || env.NETLIFY_DATABASE_URL || "";

/** @returns {Promise<Sql>} */
export async function connect({ dataDir, url = databaseUrl() } = {}) {
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    // `sql.query(text, params)` runs one parameterized statement and returns its rows.
    return { query: (text, params = []) => sql.query(text, params), close: async () => {} };
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
