import { test, before, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.NETLIFY_DATABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.INITIAL_ADMIN_EMAIL;
const { init } = await import("../server/init.js");
const { createApp } = await import("../server/app.js");
const { SCHEMA_VERSION, schemaReady } = await import("../server/schema.js");

let server, base, ctx;
const jar = {};

before(async () => {
  ctx = await init();
  await ctx.auth.createUser({ email: "ana@example.com", name: "Ana Levi", password: "ana password 123", role: "admin" });
  await ctx.auth.createUser({ email: "ben@example.com", name: "Ben Cohen", password: "ben password 123" });
  const app = createApp(ctx.store, ctx.auth);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
  for (const [who, email, pw] of [["ana", "ana@example.com", "ana password 123"], ["ben", "ben@example.com", "ben password 123"]]) {
    const r = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    jar[who] = r.headers.get("set-cookie").split(";")[0];
  }
});
after(async () => { server.close(); await ctx.sql.close(); });

const call = async (who, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: jar[who], ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method === "DELETE" ? { "x-requested-with": "workboard" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test("assigning someone notifies them, not the person who did it", async () => {
  const p = await call("ana", "POST", "/projects", { name: "Launch" });
  const t = await call("ana", "POST", "/tasks", { title: "Write the brief", assignee: "ben cohen", projectId: p.body.id });
  const ben = await call("ben", "GET", "/notifications");
  assert.equal(ben.body.unread, 1);
  assert.equal(ben.body.items[0].type, "assigned");
  assert.equal(ben.body.items[0].title, "Ana Levi assigned you “Write the brief”");
  assert.equal(ben.body.items[0].body, "in Launch");
  assert.equal(ben.body.items[0].taskId, t.body.id);
  assert.equal((await call("ana", "GET", "/notifications")).body.unread, 0, "no self-notification");

  // Ben assigns himself: no notification for anyone.
  await call("ben", "POST", "/tasks", { title: "Self task", assignee: "Ben Cohen" });
  assert.equal((await call("ben", "GET", "/notifications")).body.unread, 1);
});

test("moving an assignee's task notifies them; editing other fields doesn't", async () => {
  const t = (await call("ben", "GET", "/notifications")).body.items[0].taskId;
  await call("ana", "PATCH", `/tasks/${t}`, { notes: "more detail" });
  assert.equal((await call("ben", "GET", "/notifications")).body.unread, 1);
  await call("ana", "PATCH", `/tasks/${t}`, { status: "review" });
  const items = (await call("ben", "GET", "/notifications")).body.items;
  assert.equal(items[0].type, "status");
  assert.equal(items[0].title, "Ana Levi moved “Write the brief” to Review");
});

test("revision carries the unread count; mark read works", async () => {
  const rev = await call("ben", "GET", "/revision");
  assert.equal(rev.body.unread, 2);
  const list = (await call("ben", "GET", "/notifications")).body;
  assert.equal((await call("ben", "POST", "/notifications/read", { ids: [list.items[0].id] })).body.unread, 1);
  assert.equal((await call("ben", "POST", "/notifications/read", { all: true })).body.unread, 0);
  assert.ok((await call("ben", "GET", "/notifications")).body.items.every((n) => n.read));
});

test("due reminders: overdue, today, tomorrow; created once; respect the day sent by the browser", async () => {
  await call("ana", "POST", "/tasks", { title: "Late one", assignee: "Ben Cohen", due: day(-2) });
  await call("ana", "POST", "/tasks", { title: "Today one", assignee: "Ben Cohen", due: day(0) });
  await call("ana", "POST", "/tasks", { title: "Tomorrow one", assignee: "Ben Cohen", due: day(1) });
  await call("ana", "POST", "/tasks", { title: "Next week", assignee: "Ben Cohen", due: day(7) });
  await call("ana", "POST", "/tasks", { title: "Done late", assignee: "Ben Cohen", due: day(-3), status: "done" });
  await call("ben", "POST", "/notifications/read", { all: true });

  const first = (await call("ben", "GET", `/notifications?today=${day(0)}`)).body;
  const due = first.items.filter((n) => n.type === "due").map((n) => n.title).sort();
  assert.deepEqual(due, ["“Late one” is overdue", "“Today one” is due today", "“Tomorrow one” is due tomorrow"]);
  const again = (await call("ben", "GET", `/notifications?today=${day(0)}`)).body;
  assert.equal(again.items.filter((n) => n.type === "due").length, 3, "not duplicated");
  assert.equal((await call("ben", "GET", "/notifications?today=not-a-date")).status, 200, "bad date is ignored");
});

test("preferences turn notification types off", async () => {
  const s = await call("ben", "GET", "/settings");
  assert.deepEqual(s.body.prefs, { assigned: true, status: true, due: true });
  assert.equal((await call("ben", "PATCH", "/settings", { prefs: { assigned: "yes" } })).status, 400);
  const off = await call("ben", "PATCH", "/settings", { prefs: { assigned: false } });
  assert.deepEqual(off.body.prefs, { assigned: false, status: true, due: true });
  const n0 = (await call("ben", "GET", "/notifications")).body.items.length;
  await call("ana", "POST", "/tasks", { title: "Quiet task", assignee: "Ben Cohen" });
  assert.equal((await call("ben", "GET", "/notifications")).body.items.length, n0);
  await call("ben", "PATCH", "/settings", { prefs: { assigned: true } });
});

test("renaming yourself keeps your tasks and notifications", async () => {
  const r = await call("ben", "PATCH", "/settings", { name: "Benjamin Cohen" });
  assert.equal(r.body.name, "Benjamin Cohen");
  const board = (await call("ben", "GET", "/board")).body;
  assert.ok(board.tasks.filter((t) => /one|brief/.test(t.title)).every((t) => t.assignee === "Benjamin Cohen"));
  assert.equal((await call("ben", "GET", "/auth/me")).body.name, "Benjamin Cohen");
  await call("ana", "POST", "/tasks", { title: "After rename", assignee: "Benjamin Cohen" });
  assert.equal((await call("ben", "GET", "/notifications")).body.items[0].title, "Ana Levi assigned you “After rename”");
  assert.equal((await call("ben", "PATCH", "/settings", { name: "  " })).status, 400);
});

test("everyone can list team names (no emails)", async () => {
  const team = (await call("ben", "GET", "/team")).body;
  assert.deepEqual(team.map((u) => u.name), ["Ana Levi", "Benjamin Cohen"]);
  assert.equal(team[0].email, undefined);
});

test("an older database is upgraded to the current schema", async () => {
  const { applySchema } = await import("../server/schema.js");
  await ctx.sql.query("UPDATE meta SET value = 1 WHERE key = 'schema_version'");
  await ctx.sql.query("DROP TABLE notifications");
  assert.equal(await schemaReady(ctx.sql), false, "old version is detected");
  await applySchema(ctx.sql); // what init() runs when schemaReady is false
  assert.equal(await schemaReady(ctx.sql), true);
  const [v] = await ctx.sql.query("SELECT value FROM meta WHERE key = 'schema_version'");
  assert.equal(v.value, SCHEMA_VERSION);
  const users = await ctx.sql.query("SELECT COUNT(*)::int AS n FROM users");
  assert.equal(users[0].n, 2, "existing data is kept");
  assert.equal((await call("ben", "GET", "/notifications")).status, 200, "notifications table is back");
});
