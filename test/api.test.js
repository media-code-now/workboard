import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { createAuth } from "../server/auth.js";
import { createApp } from "../server/app.js";

let server, base, store, auth, cookie = "";

before(async () => {
  store = openDb(":memory:");
  auth = createAuth(store.raw);
  await auth.createUser({ email: "Dana@Example.com", name: "Dana", password: "correct horse battery", role: "admin" });
  const app = createApp(store, auth);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => { server.close(); store.close(); });

const call = async (method, path, body, { auth: withAuth = true, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method === "DELETE" ? { "x-requested-with": "workboard" } : {}),
      ...(withAuth && cookie ? { cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, setCookie, body: res.status === 204 ? null : await res.json() };
};

test("everything except sign-in is locked without a session", async () => {
  assert.equal((await call("GET", "/board", undefined, { auth: false })).status, 401);
  assert.equal((await call("GET", "/auth/me", undefined, { auth: false })).status, 401);
  assert.equal((await call("POST", "/tasks", { title: "x" }, { auth: false })).status, 401);
  assert.equal((await call("GET", "/health", undefined, { auth: false })).status, 200);
});

test("wrong password is rejected; right one signs in with an HttpOnly cookie", async () => {
  const bad = await call("POST", "/auth/login", { email: "dana@example.com", password: "nope" });
  assert.equal(bad.status, 401);
  const ok = await call("POST", "/auth/login", { email: " DANA@example.com ", password: "correct horse battery" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, "Dana");
  assert.equal(ok.body.password_hash, undefined);
  assert.match(ok.setCookie, /wb_session=.+HttpOnly/i);
  assert.match(ok.setCookie, /SameSite=Lax/i);
  cookie = ok.setCookie.split(";")[0];
  assert.equal((await call("GET", "/auth/me")).body.email, "dana@example.com");
});

test("creates, updates and deletes a project and task", async () => {
  const p = await call("POST", "/projects", { name: "  Launch  ", color: "teal", due: "2026-12-01" });
  assert.equal(p.status, 201);
  assert.equal(p.body.name, "Launch");

  const t = await call("POST", "/tasks", { title: "Write plan", projectId: p.body.id, priority: "high" });
  assert.equal(t.status, 201);
  assert.equal(t.body.status, "todo");

  const done = await call("PATCH", `/tasks/${t.body.id}`, { status: "done" });
  assert.ok(done.body.completedAt > 0);
  assert.equal(done.body.title, "Write plan", "PATCH keeps fields that were not sent");
  assert.equal((await call("PATCH", `/tasks/${t.body.id}`, { status: "doing" })).body.completedAt, null);

  assert.equal((await call("DELETE", `/projects/${p.body.id}`)).status, 204);
  const board = await call("GET", "/board");
  assert.equal(board.body.projects.length, 0);
  assert.equal(board.body.tasks[0].projectId, "", "tasks survive their project's deletion");
});

test("rejects invalid input and cross-site style requests", async () => {
  assert.deepEqual((await call("POST", "/tasks", { title: "" })).body, { error: "Title is required" });
  assert.equal((await call("POST", "/tasks", { title: "x", status: "blocked" })).status, 400);
  assert.equal((await call("POST", "/tasks", { title: "x", due: "next week" })).status, 400);
  assert.equal((await call("POST", "/tasks", { title: "x", projectId: "missing" })).status, 400);
  assert.equal((await call("PATCH", "/tasks/missing", { title: "x" })).status, 404);
  // a plain HTML form post (not JSON) is refused
  const form = await fetch(base + "/tasks", { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "title=x" });
  assert.equal(form.status, 415);
  // DELETE without the custom header is refused
  const del = await fetch(base + "/tasks/whatever", { method: "DELETE", headers: { cookie } });
  assert.equal(del.status, 403);
});

test("sign out ends the session", async () => {
  assert.equal((await call("POST", "/auth/logout", {})).status, 204);
  assert.equal((await call("GET", "/board")).status, 401);
});

test("repeated wrong passwords are rate limited", async () => {
  for (let i = 0; i < 5; i++) await call("POST", "/auth/login", { email: "dana@example.com", password: "wrong" }, { auth: false });
  const blocked = await call("POST", "/auth/login", { email: "dana@example.com", password: "correct horse battery" }, { auth: false });
  assert.equal(blocked.status, 429);
});

test("passwords must be long enough and emails unique", async () => {
  await assert.rejects(auth.createUser({ email: "a@b.co", name: "A", password: "short" }), /at least 10/);
  await assert.rejects(auth.createUser({ email: "dana@example.com", name: "D", password: "long enough pw" }), /already exists/);
});
