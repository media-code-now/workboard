import { test, before, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.NETLIFY_DATABASE_URL; delete process.env.DATABASE_URL; delete process.env.INITIAL_ADMIN_EMAIL;
delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
const { init } = await import("../server/init.js");
const { createNotifications } = await import("../server/notifications.js");
const { createDocuments } = await import("../server/documents.js");
const { runDigest, localNow } = await import("../server/digest.js");
const { sendEmail, layout } = await import("../server/email.js");

let ctx, notes, docs, ana, ben;
const outbox = [];
const fakeSend = async (m) => { outbox.push(m); return { sent: true }; };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const today = day(0);
const listFor = async (u) => (await notes.list(u.id)).items;

before(async () => {
  ctx = await init();
  ana = await ctx.auth.createUser({ email: "ana@example.com", name: "Ana Levi", password: "ana password 123", role: "admin" });
  ben = await ctx.auth.createUser({ email: "ben@example.com", name: "Ben Cohen", password: "ben password 123" });
  notes = createNotifications(ctx.sql, { send: fakeSend });
  docs = createDocuments(ctx.sql);
});
after(async () => { await ctx.sql.close(); });

test("assignment sends an instant email to the assignee (and respects the setting)", async () => {
  outbox.length = 0;
  const t = await ctx.store.createTask({ title: "Write brief", assignee: "Ben Cohen" }, { createdBy: ana.id });
  await notes.onTaskChange(ana, null, t, null);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "ben@example.com");
  assert.equal(outbox[0].subject, 'Ana Levi assigned you "Write brief"');
  assert.match(outbox[0].html, /Open Workboard/);
  await notes.setPrefs(ben.id, { emailInstant: false });
  const t2 = await ctx.store.createTask({ title: "Quiet one", assignee: "Ben Cohen" }, { createdBy: ana.id });
  await notes.onTaskChange(ana, null, t2, null);
  assert.equal(outbox.length, 1, "no email when instant emails are off");
  assert.equal((await listFor(ben)).filter((n) => n.type === "assigned").length, 2, "still notified in the app");
  await notes.setPrefs(ben.id, { emailInstant: true });
});

test("the creator hears when someone else completes their task", async () => {
  outbox.length = 0;
  const t = await ctx.store.createTask({ title: "Fix Wine Bank", assignee: "Ben Cohen" }, { createdBy: ana.id });
  const done = await ctx.store.updateTask(t.id, { status: "done" });
  await notes.onTaskChange(ben, t, done, null);
  const n = (await listFor(ana))[0];
  assert.equal(n.type, "completed");
  assert.equal(n.title, "Ben Cohen completed “Fix Wine Bank”");
  assert.equal(outbox.at(-1).to, "ana@example.com");
  // Completing your own task notifies nobody.
  const own = await ctx.store.createTask({ title: "Own task", assignee: "Ana Levi" }, { createdBy: ana.id });
  const before = (await listFor(ana)).length;
  await notes.onTaskChange(ana, own, await ctx.store.updateTask(own.id, { status: "done" }), null);
  assert.equal((await listFor(ana)).length, before);
});

test("reminders are withdrawn when the due date moves or the task is done (the wrong 'overdue' bug)", async () => {
  const t = await ctx.store.createTask({ title: "Haim - Web development", assignee: "Ben Cohen", due: day(-1) }, { createdBy: ana.id });
  await notes.ensureDueReminders(ben, today, { force: true });
  assert.ok((await listFor(ben)).some((n) => n.title === "“Haim - Web development” is overdue"));
  const moved = await ctx.store.updateTask(t.id, { due: day(3) });
  await notes.onTaskChange(ana, t, moved, null);
  assert.ok(!(await listFor(ben)).some((n) => n.title.includes("Haim") && n.type === "due"), "stale overdue reminder removed");
  const soon = await ctx.store.updateTask(t.id, { due: day(0) });
  await notes.onTaskChange(ana, moved, soon, null);
  await notes.ensureDueReminders(ben, today, { force: true });
  assert.ok((await listFor(ben)).some((n) => n.title === "“Haim - Web development” is due today"));
  const done = await ctx.store.updateTask(t.id, { status: "done" });
  await notes.onTaskChange(ben, soon, done, null);
  assert.ok(!(await listFor(ben)).some((n) => n.title.includes("Haim") && n.type === "due"), "done task has no reminders");
  assert.equal(outbox.filter((m) => /overdue|due today/.test(m.subject)).length, 0, "reminders aren't emailed one by one");
});

test("leads: owner assignment notifies (with a link to Lead Desk) and follow-ups remind", async () => {
  outbox.length = 0;
  const lead = { name: "Yaron Lesri", company: "Junk Removal", owner: "Ben Cohen", stage: "New", nextFollowUp: day(-1), subService: "Local SEO", ask: "SEO and Google Ads" };
  await docs.set("leads", "lead1", lead);
  await notes.onLeadChange(ana, "lead1", null, lead);
  const n = (await listFor(ben))[0];
  assert.equal(n.type, "lead"); assert.equal(n.link, "/leads/");
  assert.equal(n.title, "Ana Levi assigned you the lead “Yaron Lesri · Junk Removal”");
  assert.equal(outbox.length, 1); assert.match(outbox[0].html, /\/leads\//);
  await notes.ensureDueReminders(ben, today, { force: true });
  assert.ok((await listFor(ben)).some((x) => x.type === "leaddue" && x.title === "Follow-up with “Yaron Lesri · Junk Removal” is overdue"));
  const won = { ...lead, stage: "Won", nextFollowUp: "" };
  await docs.set("leads", "lead1", won);
  await notes.onLeadChange(ana, "lead1", lead, won);
  assert.ok(!(await listFor(ben)).some((x) => x.type === "leaddue"), "closed lead has no reminders");
});

test("daily summary: once per day, only from 7am local time, only with something to say", async () => {
  outbox.length = 0;
  await ctx.store.createTask({ title: "Due today task", assignee: "Ben Cohen", due: localNow("UTC").day }, { createdBy: ana.id });
  await notes.setPrefs(ben.id, { tz: "UTC" });
  await notes.setPrefs(ana.id, { tz: "UTC", emailDigest: false });
  const at = (h) => { const d = new Date(); d.setUTCHours(h, 5, 0, 0); return d; };
  let r = await runDigest(ctx.sql, { now: at(6), send: fakeSend });
  assert.equal(r.sent.length, 0, "before 7am nothing is sent");
  r = await runDigest(ctx.sql, { now: at(7), send: fakeSend });
  assert.deepEqual(r.sent, ["ben@example.com"], "Ben gets it; Ana turned it off");
  assert.match(outbox[0].subject, /^Workboard: \d+ things? for /);
  assert.match(outbox[0].html, /Due today task/);
  r = await runDigest(ctx.sql, { now: at(9), send: fakeSend });
  assert.equal(r.sent.length, 0, "not twice on the same day");
});

test("a failed summary is retried on the next run", async () => {
  const c2 = await init();
  const u = await c2.auth.createUser({ email: "cy@example.com", name: "Cy", password: "cy password 1234" });
  const n2 = createNotifications(c2.sql);
  await n2.setPrefs(u.id, { tz: "UTC" });
  await c2.store.createTask({ title: "Late", assignee: "Cy", due: "2020-01-01" });
  const at8 = new Date(); at8.setUTCHours(8, 0, 0, 0);
  let r = await runDigest(c2.sql, { now: at8, send: async () => ({ sent: false, error: "boom" }) });
  assert.equal(r.sent.length, 0);
  r = await runDigest(c2.sql, { now: at8, send: fakeSend });
  assert.deepEqual(r.sent, ["cy@example.com"]);
  await c2.sql.close();
});

test("time zone must be real; email is skipped (not an error) when not configured", async () => {
  await assert.rejects(notes.setPrefs(ben.id, { tz: "Mars/Olympus" }), /Unknown time zone/);
  assert.equal((await notes.setPrefs(ben.id, { tz: "Asia/Jerusalem" })).tz, "Asia/Jerusalem");
  const r = await sendEmail({ to: "x@example.com", subject: "s", html: "h", text: "t" }, { env: {} });
  assert.equal(r.sent, false); assert.match(r.skipped, /isn't set up/);
  let called;
  const ok = await sendEmail({ to: "x@example.com", subject: "s", html: "h", text: "t" },
    { env: { RESEND_API_KEY: "k", EMAIL_FROM: "W <w@example.com>" }, fetchImpl: async (url, init) => { called = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return new Response(JSON.stringify({ id: "e1" }), { status: 200 }); } });
  assert.deepEqual(ok, { sent: true, id: "e1" });
  assert.equal(called.url, "https://api.resend.com/emails"); assert.equal(called.auth, "Bearer k"); assert.deepEqual(called.body.to, ["x@example.com"]);
  const { html } = layout({ heading: "<script>x</script>" });
  assert.doesNotMatch(html, /<script>/, "email content is escaped");
});
