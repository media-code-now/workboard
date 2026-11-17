// Netlify Function that serves the whole /api. netlify.toml routes /api/* here.
//
// Everything is imported lazily inside try/catch so that any startup problem
// (missing module, database not configured, connection failure) comes back as a
// readable JSON error and shows in the function log, instead of a bare 502.

const BUILD = "2026-11-17.3"; // bump to confirm which version Netlify is serving

let ready;
let setupInfo = { status: "not started" };

function getHandler() {
  ready ??= (async () => {
    const started = Date.now();
    setupInfo = { status: "starting" };
    const [{ default: serverless }, { init }, { createApp }] = await Promise.all([
      import("serverless-http"),
      import("../../server/init.js"),
      import("../../server/app.js"),
    ]);
    const { store, auth } = await init();
    const run = serverless(createApp(store, auth, { secureCookies: true }));
    setupInfo = { status: "ok", setupMs: Date.now() - started };
    return run;
  })();
  ready.catch((e) => {
    ready = undefined; // retry on the next request
    setupInfo = { status: "failed", error: String(e?.message || e).slice(0, 300) };
  });
  return ready;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

export const handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const path = String(event.path || "").replace(/^\/\.netlify\/functions\/api/, "/api");

  // Diagnostics that work even when the app itself can't start.
  if (path === "/api/health") {
    try { await getHandler(); } catch { /* reported below */ }
    return json(setupInfo.status === "ok" ? 200 : 503, {
      ok: setupInfo.status === "ok",
      build: BUILD,
      node: process.version,
      databaseConfigured: Boolean(process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL),
      setup: setupInfo,
    });
  }

  let run;
  try {
    run = await getHandler();
  } catch (e) {
    console.error("Workboard setup failed:", e);
    const noDb = /No database configured/.test(e?.message);
    return json(503, {
      error: noDb
        ? "The database isn't set up yet. In Netlify, enable Netlify DB for this site, then redeploy."
        : `The server couldn't start: ${String(e?.message || e).slice(0, 200)}`,
    });
  }

  try {
    return await run(event, context);
  } catch (e) {
    console.error("Workboard request failed:", e);
    return json(500, { error: "Something went wrong on the server." });
  }
};
