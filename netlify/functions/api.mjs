// Netlify Function (v2, ES module) that serves the whole /api.
//
// v2 functions receive a web Request and return a Response. The Express app is
// reached through serverless-http, so we convert Request -> Lambda-style event and
// the result back to a Response. Everything is imported lazily inside try/catch,
// so startup problems come back as readable JSON errors and show in the log.

const BUILD = "2026-11-17.5"; // bump to confirm which version Netlify is serving

export const config = { path: "/api/*" };

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

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Web Request -> the API Gateway-style event serverless-http understands. */
async function toEvent(req, context) {
  const url = new URL(req.url);
  const headers = Object.fromEntries(req.headers);
  if (context?.ip && !headers["x-nf-client-connection-ip"]) headers["x-nf-client-connection-ip"] = context.ip;
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const body = hasBody ? Buffer.from(await req.arrayBuffer()) : null;
  const multi = {};
  for (const [k, v] of url.searchParams) (multi[k] ??= []).push(v);
  return {
    httpMethod: req.method,
    path: url.pathname,
    headers,
    multiValueHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])),
    queryStringParameters: Object.fromEntries(url.searchParams),
    multiValueQueryStringParameters: multi,
    body: body && body.length ? body.toString("base64") : null,
    isBase64Encoded: Boolean(body && body.length),
    requestContext: { identity: { sourceIp: context?.ip } },
  };
}

/** serverless-http result -> web Response (keeps multiple Set-Cookie headers). */
function toResponse(result) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(result.headers ?? {})) if (v != null) headers.set(k, String(v));
  for (const [k, list] of Object.entries(result.multiValueHeaders ?? {})) {
    headers.delete(k);
    for (const v of list ?? []) headers.append(k, String(v));
  }
  const status = result.statusCode ?? 200;
  const noBody = status === 204 || status === 304;
  const body = noBody || result.body == null ? null : result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body;
  return new Response(body, { status, headers });
}

export default async (req, context) => {
  const path = new URL(req.url).pathname;

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
        ? "The database isn't set up yet. In Netlify, add DATABASE_URL (your Neon connection string) to the environment variables, then redeploy."
        : `The server couldn't start: ${String(e?.message || e).slice(0, 200)}`,
    });
  }

  try {
    return toResponse(await run(await toEvent(req, context), {}));
  } catch (e) {
    console.error("Workboard request failed:", e);
    return json(500, { error: "Something went wrong on the server." });
  }
};
