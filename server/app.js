import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ValidationError } from "./db.js";

/** Optional shared login (HTTP Basic auth) when APP_USER and APP_PASSWORD are set. */
function basicAuth(user, password) {
  const expected = Buffer.from(`${user}:${password}`);
  return (req, res, next) => {
    const header = req.get("authorization") || "";
    const given = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64") : Buffer.alloc(0);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.set("WWW-Authenticate", 'Basic realm="Workboard", charset="UTF-8"').status(401).send("Sign in required");
  };
}

export function createApp(store, { staticDir, auth } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  if (auth?.user && auth?.password) app.use(basicAuth(auth.user, auth.password));

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

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
