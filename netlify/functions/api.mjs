// Netlify Function that serves the whole /api. netlify.toml routes /api/* here.
import serverless from "serverless-http";
import { init } from "../../server/init.js";
import { createApp } from "../../server/app.js";

// Reused across invocations while the function instance stays warm.
let ready;
function getHandler() {
  ready ??= init().then(({ store, auth }) => serverless(createApp(store, auth, { secureCookies: true })));
  ready.catch(() => { ready = undefined; }); // retry setup on the next request if it failed
  return ready;
}

export const handler = async (event, context) => {
  let run;
  try {
    run = await getHandler();
  } catch (e) {
    // Setup failed (most often: Netlify DB not enabled yet). Explain it instead of crashing with a 502.
    console.error("Workboard setup failed:", e);
    const noDb = /No database configured/.test(e?.message);
    return {
      statusCode: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({
        error: noDb
          ? "The database isn't set up yet. In Netlify, enable Netlify DB for this site, then redeploy."
          : "The server couldn't connect to the database. Check the function logs in Netlify.",
      }),
    };
  }
  return run(event, context);
};
