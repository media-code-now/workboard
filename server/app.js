import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SESSION_COOKIE, createLoginLimiter, parseCookies } from "./auth.js";
import { ValidationError } from "./db.js";

/**
 * @param store  data store from openDb()
 * @param auth   accounts from createAuth()
 * @param opts.staticDir      built frontend to serve (production)
 * @param opts.secureCookies  mark the session cookie Secure (set when served over HTTPS)
 */
export function createApp(store, auth, { staticDir, secureCookies = false } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  // Changes must be JSON: browsers can't send that cross-site without CORS, which blocks CSRF.
  app.use("/api", (req, res, next) => {
    // DELETE has no body, so it carries a custom header instead (also impossible cross-site without CORS).
    if (["POST", "PATCH", "PUT"].includes(req.method) && !req.is("application/json")) {
      return res.status(415).json({ error: "Requests must be sent as JSON" });
    }
    if (req.method === "DELETE" && req.get("x-requested-with") !== "workboard") {
      return res.status(403).json({ error: "Missing request header" });
    }
    next();
  });

  // ---- accounts ----
  const limiter = createLoginLimiter();
  const cookieOpts = { httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/" };
  const tokenOf = (req) => parseCookies(req.get("cookie"))[SESSION_COOKIE];

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    const wait = limiter.blockedFor(req.ip, email);
    if (wait) return res.status(429).set("Retry-After", String(wait)).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` });
    const user = await auth.authenticate(email, password);
    if (!user) {
      limiter.fail(req.ip, email);
      return res.status(401).json({ error: "That email and password don't match." });
    }
    limiter.reset(req.ip, email);
    const { token, maxAgeMs } = auth.startSession(user.id);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: maxAgeMs });
    res.json(user);
  });

  app.post("/api/auth/logout", (req, res) => {
    auth.endSession(tokenOf(req));
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.status(204).end();
  });

  // Everything below requires a signed-in user.
  app.use("/api", (req, res, next) => {
    const user = auth.userForToken(tokenOf(req));
    if (!user) return res.status(401).json({ error: "Please sign in." });
    req.user = user;
    next();
  });

  app.get("/api/auth/me", (req, res) => res.json(req.user));

  // ---- live updates (Server-Sent Events) ----
  const clients = new Set();
  const broadcast = (event) => {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write("retry: 3000\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
  });

  app.get("/api/board", (_req, res) => res.json({ projects: store.listProjects(), tasks: store.listTasks() }));

  // ---- projects ----
  app.get("/api/projects", (_req, res) => res.json(store.listProjects()));
  app.post("/api/projects", (req, res) => {
    const project = store.createProject(req.body ?? {});
    broadcast({ type: "project.upsert", project });
    res.status(201).json(project);
  });
  app.patch("/api/projects/:id", (req, res) => {
    const project = store.updateProject(req.params.id, req.body ?? {});
    if (!project) return res.status(404).json({ error: "Project not found" });
    broadcast({ type: "project.upsert", project });
    res.json(project);
  });
  app.delete("/api/projects/:id", (req, res) => {
    if (!store.deleteProject(req.params.id)) return res.status(404).json({ error: "Project not found" });
    broadcast({ type: "project.delete", id: req.params.id });
    res.status(204).end();
  });

  // ---- tasks ----
  app.get("/api/tasks", (_req, res) => res.json(store.listTasks()));
  app.post("/api/tasks", (req, res) => {
    const task = store.createTask(req.body ?? {});
    broadcast({ type: "task.upsert", task });
    res.status(201).json(task);
  });
  app.patch("/api/tasks/:id", (req, res) => {
    const task = store.updateTask(req.params.id, req.body ?? {});
    if (!task) return res.status(404).json({ error: "Task not found" });
    broadcast({ type: "task.upsert", task });
    res.json(task);
  });
  app.delete("/api/tasks/:id", (req, res) => {
    if (!store.deleteTask(req.params.id)) return res.status(404).json({ error: "Task not found" });
    broadcast({ type: "task.delete", id: req.params.id });
    res.status(204).end();
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // ---- built frontend ----
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => res.sendFile(join(staticDir, "index.html")));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Request body is not valid JSON" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server" });
  });

  app.locals.closeStreams = () => { for (const res of clients) res.end(); clients.clear(); };
  return app;
}
