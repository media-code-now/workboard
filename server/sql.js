// Postgres connection. Uses Netlify DB (Neon) when NETLIFY_DATABASE_URL is set,
// otherwise an embedded Postgres (PGlite) stored on disk, or in memory for tests.

/**
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<any[]>, close: () => Promise<void> }} Sql
 */

/** @returns {Promise<Sql>} */
export async function connect({ dataDir } = {}) {
  const url = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import("@netlify/neon");
    const sql = neon(url);
    return { query: (text, params = []) => sql.query(text, params), close: async () => {} };
  }
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) {
    throw new Error("No database configured. Enable Netlify DB for this site (it sets NETLIFY_DATABASE_URL), then redeploy.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows,
    close: () => db.close(),
  };
}
