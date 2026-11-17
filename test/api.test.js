import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";

let server, base, store;

before(async () => {
  store = openDb(":memory:");
  const app = createApp(store);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}/api`;
});
after(() => { server.close(); store.close(); });

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test("creates, updates and deletes a project and task", async () => {
  const p = await call("POST", "/projects", { name: "  Launch  ", color: "teal", due: "2026-12-01" });
  assert.equal(p.status, 201);
  assert.equal(p.body.name, "Launch");

  const t = await call("POST", "/tasks", { title: "Write plan", projectId: p.body.id, priority: "high" });
  assert.equal(t.status, 201);
  assert.equal(t.body.status, "todo");
  assert.equal(t.body.completedAt, null);

  const done = await call("PATCH", `/tasks/${t.body.id}`, { status: "done" });
  assert.equal(done.body.status, "done");
  assert.ok(done.body.completedAt > 0);
  assert.equal(done.body.title, "Write plan", "PATCH keeps fields that were not sent");

  const reopened = await call("PATCH", `/tasks/${t.body.id}`, { status: "doing" });
  assert.equal(reopened.body.completedAt, null);

  assert.equal((await call("DELETE", `/projects/${p.body.id}`)).status, 204);
  const board = await call("GET", "/board");
  assert.equal(board.body.projects.length, 0);
  assert.equal(board.body.tasks[0].projectId, "", "tasks survive their project's deletion");
});

test("rejects invalid input with a readable message", async () => {
  assert.deepEqual(await call("POST", "/tasks", { title: "" }), { status: 400, body: { error: "Title is required" } });
  assert.equal((await call("POST", "/tasks", { title: "x", status: "blocked" })).status, 400);
  assert.equal((await call("POST", "/tasks", { title: "x", due: "next week" })).status, 400);
  assert.equal((await call("POST", "/tasks", { title: "x", projectId: "missing" })).status, 400);
  assert.equal((await call("PATCH", "/tasks/missing", { title: "x" })).status, 404);
});
