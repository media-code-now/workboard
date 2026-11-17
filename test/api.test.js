import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Always test against an in-memory Postgres, never a real database.
delete process.env.NETLIFY_DATABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.INITIAL_ADMIN_EMAIL;
const { init } = await import("../server/init.js");
const { createApp } = await import("../server/app.js");

let server, base, sql, auth;
const jar = { admin: "", member: "" };

before(async () => {
  const ctx = await init();
  sql = ctx.sql; auth = ctx.auth;
  await auth.createUser({ email: "Dana@Example.com", name: "Dana", password: "correct horse battery", role: "admin" });
  const app = createApp(ctx.store, ctx.auth);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => { server.close(); await sql.close(); });

const call = async (method, path, body, { as = "admin", headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method === "DELETE" ? { "x-requested-with": "workboard" } : {}),
      ...(as && jar[as] ? { cookie: jar[as] } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, setCookie: res.headers.get("set-cookie"), body: res.status === 204 ? null : await res.json() };
};
const login = async (who, email, password) => {
  const r = await call("POST", "/auth/login", { email, password }, { as: null });
  if (r.setCookie) jar[who] = r.setCookie.split(";")[0];
  return r;
};

test("everything except sign-in is locked without a session", async () => {
  assert.equal((await call("GET", "/board", undefined, { as: null })).status, 401);
  assert.equal((await call("GET", "/revision", undefined, { as: null })).status, 401);
  assert.equal((await call("POST", "/tasks", { title: "x" }, { as: null })).status, 401);
  assert.equal((await call("GET", "/health", undefined, { as: null })).status, 200);
});

test("wrong password is rejected; right one signs in with an HttpOnly cookie", async () => {
  assert.equal((await login("admin", "dana@example.com", "nope")).status, 401);
  const ok = await login("admin", " DANA@example.com ", "correct horse battery");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.name, "Dana");
  assert.equal(ok.body.password_hash, undefined);
  assert.match(ok.setCookie, /wb_session=.+HttpOnly/i);
  assert.match(ok.setCookie, /SameSite=Lax/i);
  assert.equal((await call("GET", "/auth/me")).body.email, "dana@example.com");
});

test("projects and tasks: create, update, delete; revision moves on every change", async () => {
  const rev0 = (await call("GET", "/revision")).body.rev;
  const p = await call("POST", "/projects", { name: "  Launch  ", color: "teal", due: "2026-12-01" });
  assert.equal(p.status, 201);
  assert.equal(p.body.name, "Launch");
  assert.equal(typeof p.body.createdAt, "number");

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
  assert.ok(board.body.rev >= rev0 + 5);
});

test("rejects invalid input and cross-site style requests", async () => {
  assert.deepEqual((await call("POST", "/tasks", { title: "" })).body, { error: "Title is required" });
  assert.equal((await call("POST", "/tasks", { title: "x", status: "blocked" })).status, 400);
  assert.equal((await call("POST", "/tasks", { title: "x", due: "next week" })).status, 400);
  assert.equal((await call("POST", "/tasks", { title: "x", projectId: "missing" })).status, 400);
  assert.equal((await call("PATCH", "/tasks/missing", { title: "x" })).status, 404);
  const form = await fetch(base + "/tasks", { method: "POST", headers: { cookie: jar.admin, "content-type": "application/x-www-form-urlencoded" }, body: "title=x" });
  assert.equal(form.status, 415);
  const del = await fetch(base + "/tasks/whatever", { method: "DELETE", headers: { cookie: jar.admin } });
  assert.equal(del.status, 403);
});

test("admins manage the team; members can't", async () => {
  const added = await call("POST", "/users", { email: "noa@example.com", name: "Noa", role: "member" });
  assert.equal(added.status, 201);
  assert.ok(added.body.temporaryPassword.length >= 12);
  assert.equal((await login("member", "noa@example.com", added.body.temporaryPassword)).status, 200);

  assert.equal((await call("GET", "/users", undefined, { as: "member" })).status, 403);
  assert.equal((await call("POST", "/users", { email: "x@example.com", name: "X" }, { as: "member" })).status, 403);
  assert.equal((await call("GET", "/board", undefined, { as: "member" })).status, 200, "members still use the board");

  const reset = await call("POST", `/users/${added.body.user.id}/reset-password`, {});
  assert.equal(reset.status, 200);
  assert.equal((await call("GET", "/board", undefined, { as: "member" })).status, 401, "reset signs the member out");

  const me = (await call("GET", "/auth/me")).body;
  assert.equal((await call("DELETE", `/users/${me.id}`)).status, 400, "can't remove yourself");
  assert.equal((await call("DELETE", `/users/${added.body.user.id}`)).status, 204);
  assert.equal((await call("GET", "/users")).body.length, 1);
});

test("changing your own password keeps this session and checks the old one", async () => {
  assert.equal((await call("POST", "/auth/password", { currentPassword: "wrong", newPassword: "another long password" })).status, 400);
  assert.equal((await call("POST", "/auth/password", { currentPassword: "correct horse battery", newPassword: "short" })).status, 400);
  assert.equal((await call("POST", "/auth/password", { currentPassword: "correct horse battery", newPassword: "another long password" })).status, 204);
  assert.equal((await call("GET", "/auth/me")).status, 200);
  assert.equal((await login("other", "dana@example.com", "another long password")).status, 200);
});

test("sign out ends the session", async () => {
  assert.equal((await call("POST", "/auth/logout", {})).status, 204);
  assert.equal((await call("GET", "/board")).status, 401);
});

test("repeated wrong passwords are rate limited", async () => {
  for (let i = 0; i < 5; i++) await login("x", "dana@example.com", "wrong");
  assert.equal((await login("x", "dana@example.com", "another long password")).status, 429);
});

test("first admin can be created from environment variables, only once", async () => {
  const ctx = await init();
  const env = { INITIAL_ADMIN_EMAIL: "boss@example.com", INITIAL_ADMIN_PASSWORD: "bootstrap password", INITIAL_ADMIN_NAME: "Boss" };
  const created = await ctx.auth.bootstrapAdmin(env);
  assert.equal(created.role, "admin");
  assert.equal(await ctx.auth.bootstrapAdmin(env), null, "does nothing once users exist");
  await ctx.sql.close();
});
