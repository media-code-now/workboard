import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SESSION_COOKIE, generatePassword, parseCookies } from "./auth.js";
import { ValidationError } from "./store.js";

/**
 * @param store  projects/tasks from createStore()
 * @param auth   accounts from createAuth()
 * @param opts.staticDir      built frontend to serve (local production server only)
 * @param opts.secureCookies  mark the session cookie Secure (set when served over HTTPS)
 */
export function createApp(store, auth, { staticDir, secureCookies = false } = {}) {
  const app = express();
  app.disable("x-powered-by");

  // On Netlify, requests arrive as /.netlify/functions/api/...; map them back to /api/...
  app.use((req, _res, next) => {
    if (req.url.startsWith("/.netlify/functions/api")) req.url = "/api" + req.url.slice("/.netlify/functions/api".length);
    next();
  });
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  // Changes must be JSON, and deletes carry a custom header. Browsers can't send either
  // cross-site without CORS, which blocks other sites from acting as a signed-in user.
  app.use("/api", (req, res, next) => {
    if (["POST", "PATCH", "PUT"].includes(req.method) && !req.is("application/json")) {
      return res.status(415).json({ error: "Requests must be sent as JSON" });
    }
    if (req.method === "DELETE" && req.get("x-requested-with") !== "workboard") {
      return res.status(403).json({ error: "Missing request header" });
    }
    res.set("Cache-Control", "no-store");
    next();
  });

  // ---- accounts ----
  const cookieOpts = { httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/" };
  const tokenOf = (req) => parseCookies(req.get("cookie"))[SESSION_COOKIE];
  const clientIp = (req) => req.get("x-nf-client-connection-ip") || req.ip || "unknown";

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    const ip = clientIp(req);
    const wait = await auth.blockedFor(ip, email);
    if (wait) return res.status(429).set("Retry-After", String(wait)).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` });
    const user = await auth.authenticate(email, password);
    if (!user) {
      await auth.recordFailure(ip, email);
      return res.status(401).json({ error: "That email and password don't match." });
    }
    await auth.clearFailures(ip, email);
    const { token, maxAgeMs } = await auth.startSession(user.id);
    res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: maxAgeMs });
    res.json(user);
  });

  app.post("/api/auth/logout", async (req, res) => {
    await auth.endSession(tokenOf(req));
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.status(204).end();
  });

  // Everything below requires a signed-in user.
  app.use("/api", async (req, res, next) => {
    const user = await auth.userForToken(tokenOf(req));
    if (!user) return res.status(401).json({ error: "Please sign in." });
    req.user = user;
    next();
  });

  app.get("/api/auth/me", (req, res) => res.json(req.user));
  app.post("/api/auth/password", async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    await auth.changeOwnPassword(req.user.id, currentPassword, newPassword, tokenOf(req));
    res.status(204).end();
  });

  // ---- team (admins only) ----
  const adminOnly = (req, res, next) => (req.user.role === "admin" ? next() : res.status(403).json({ error: "Only admins can manage the team." }));
  app.get("/api/users", adminOnly, async (_req, res) => res.json(await auth.listUsers()));
  app.post("/api/users", adminOnly, async (req, res) => {
    const { email, name, role } = req.body ?? {};
    const password = generatePassword();
    const user = await auth.createUser({ email, name, role, password });
    res.status(201).json({ user, temporaryPassword: password });
  });
  app.post("/api/users/:id/reset-password", adminOnly, async (req, res) => {
    const user = await auth.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const password = generatePassword();
    await auth.setPassword(user.id, password);
    res.json({ user, temporaryPassword: password });
  });
  app.delete("/api/users/:id", adminOnly, async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
    const user = await auth.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "admin" && (await auth.adminCount()) <= 1) return res.status(400).json({ error: "Keep at least one admin." });
    await auth.removeUser(user.id);
    res.status(204).end();
  });

  // ---- board ----
  // Browsers poll this every few seconds; it's one tiny query.
  app.get("/api/revision", async (_req, res) => res.json({ rev: await store.revision() }));
  app.get("/api/board", async (_req, res) => {
    const [rev, projects, tasks] = await Promise.all([store.revision(), store.listProjects(), store.listTasks()]);
    res.json({ rev, projects, tasks });
  });

  app.post("/api/projects", async (req, res) => res.status(201).json(await store.createProject(req.body ?? {})));
  app.patch("/api/projects/:id", async (req, res) => {
    const project = await store.updateProject(req.params.id, req.body ?? {});
    return project ? res.json(project) : res.status(404).json({ error: "Project not found" });
  });
  app.delete("/api/projects/:id", async (req, res) => {
    return (await store.deleteProject(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Project not found" });
  });

  app.post("/api/tasks", async (req, res) => res.status(201).json(await store.createTask(req.body ?? {})));
  app.patch("/api/tasks/:id", async (req, res) => {
    const task = await store.updateTask(req.params.id, req.body ?? {});
    return task ? res.json(task) : res.status(404).json({ error: "Task not found" });
  });
  app.delete("/api/tasks/:id", async (req, res) => {
    return (await store.deleteTask(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Task not found" });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // ---- built frontend (local production server; Netlify serves dist/ itself) ----
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

  return app;
}
