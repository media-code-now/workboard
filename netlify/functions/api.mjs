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

export const handler = async (event, context) => (await getHandler())(event, context);
