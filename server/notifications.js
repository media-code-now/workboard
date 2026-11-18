// In-app notifications and per-user notification preferences.
//
// People are matched to tasks by name: a task's assignee text is compared,
// case-insensitively, with account names. Renaming yourself in Settings also
// renames you on tasks and projects, so the match keeps working.
import { randomUUID } from "node:crypto";
import { ValidationError } from "./store.js";

export const NOTIFY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    task_id    TEXT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT,
    created_at FLOAT8 NOT NULL,
    read_at    FLOAT8
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb`,
];

export const DEFAULT_PREFS = { assigned: true, status: true, due: true };
const STATUS_LABEL = { todo: "To Do", doing: "In Progress", review: "Review", done: "Done" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_DAYS = 60;
const DUE_CHECK_EVERY_MS = 10 * 60000;

const prefsOf = (row) => ({ ...DEFAULT_PREFS, ...(typeof row?.prefs === "string" ? JSON.parse(row.prefs) : row?.prefs ?? {}) });
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const quote = (s) => `“${s.length > 80 ? s.slice(0, 77) + "…" : s}”`;
const row = (r) => ({ id: r.id, type: r.type, taskId: r.task_id ?? "", title: r.title, body: r.body, createdAt: r.created_at, read: r.read_at != null });

/** @param {import("./sql.js").Sql} sql */
export function createNotifications(sql) {
  const lastDueCheck = new Map(); // userId -> { at, today }, per server instance

  async function usersNamed(name) {
    if (!name?.trim()) return [];
    return sql.query("SELECT id, name, prefs FROM users WHERE lower(name) = lower($1)", [name.trim()]);
  }
  async function insert(userId, n) {
    await sql.query(
      `INSERT INTO notifications (id, user_id, type, task_id, title, body, dedupe_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [randomUUID(), userId, n.type, n.taskId ?? null, n.title, n.body ?? "", n.dedupeKey ?? null, Date.now()]);
  }

  return {
    async getPrefs(userId) {
      const [r] = await sql.query("SELECT prefs FROM users WHERE id = $1", [userId]);
      return prefsOf(r);
    },
    async setPrefs(userId, input) {
      const current = await this.getPrefs(userId);
      const next = { ...current };
      for (const k of Object.keys(DEFAULT_PREFS)) {
        if (k in (input ?? {})) {
          if (typeof input[k] !== "boolean") throw new ValidationError(`Setting "${k}" must be on or off`);
          next[k] = input[k];
        }
      }
      await sql.query("UPDATE users SET prefs = $1::jsonb WHERE id = $2", [JSON.stringify(next), userId]);
      return next;
    },

    /** Called after a task is created or changed by `actor`. */
    async onTaskChange(actor, before, after, project) {
      if (!after) return;
      const where = project?.name ? `in ${project.name}` : "";
      const newAssignee = after.assignee && (!before || before.assignee.trim().toLowerCase() !== after.assignee.trim().toLowerCase());
      for (const u of await usersNamed(after.assignee)) {
        if (u.id === actor.id) continue;
        const prefs = prefsOf(u);
        if (newAssignee) {
          if (prefs.assigned) await insert(u.id, { type: "assigned", taskId: after.id, title: `${actor.name} assigned you ${quote(after.title)}`, body: where });
        } else if (before && before.status !== after.status && prefs.status) {
          await insert(u.id, { type: "status", taskId: after.id, title: `${actor.name} moved ${quote(after.title)} to ${STATUS_LABEL[after.status]}`, body: where });
        }
      }
    },

    /** Creates due-date reminders for the user's open tasks (at most every 10 min per user). */
    async ensureDueReminders(user, today, { force = false } = {}) {
      if (!DATE_RE.test(String(today))) return;
      const last = lastDueCheck.get(user.id);
      if (!force && last && last.today === today && Date.now() - last.at < DUE_CHECK_EVERY_MS) return;
      lastDueCheck.set(user.id, { at: Date.now(), today });
      if (!(await this.getPrefs(user.id)).due) return;
      const tomorrow = addDays(today, 1);
      const tasks = await sql.query(
        `SELECT id, title, due FROM tasks
         WHERE lower(assignee) = lower($1) AND status <> 'done' AND due <> '' AND due <= $2`,
        [user.name, tomorrow]);
      for (const t of tasks) {
        const kind = t.due < today ? "overdue" : t.due === today ? "today" : "soon";
        const title = kind === "overdue" ? `${quote(t.title)} is overdue` : kind === "today" ? `${quote(t.title)} is due today` : `${quote(t.title)} is due tomorrow`;
        const body = kind === "overdue" ? `It was due ${fmt(t.due)}.` : "";
        await insert(user.id, { type: "due", taskId: t.id, title, body, dedupeKey: `${kind}:${t.id}:${t.due}` });
      }
    },

    async unreadCount(userId) {
      const [r] = await sql.query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [userId]);
      return r.n;
    },
    async list(userId, limit = 50) {
      await sql.query("DELETE FROM notifications WHERE user_id = $1 AND created_at < $2", [userId, Date.now() - KEEP_DAYS * 86400000]);
      const rows = await sql.query("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, Math.min(100, Math.max(1, limit))]);
      return { unread: await this.unreadCount(userId), items: rows.map(row) };
    },
    async markRead(userId, { ids, all } = {}) {
      if (all) {
        await sql.query("UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL", [userId, Date.now()]);
      } else if (Array.isArray(ids) && ids.length) {
        await sql.query("UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND id = ANY($2::text[]) AND read_at IS NULL", [userId, ids.slice(0, 200).map(String), Date.now()]);
      }
      return this.unreadCount(userId);
    },
  };
}
