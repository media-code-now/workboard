// In-app notifications, email for them, and per-user notification preferences.
//
// People are matched to tasks and leads by name: a task's assignee (or a lead's owner)
// is compared, case-insensitively, with account names. Renaming yourself in Settings
// also renames you on tasks and projects, so the match keeps working.
import { randomUUID } from "node:crypto";
import { ValidationError } from "./store.js";
import { appUrl, layout, sendEmail } from "./email.js";

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
  // v4: links (lead notifications open Lead Desk), who created each task, one daily summary per person per day
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `CREATE TABLE IF NOT EXISTS digest_log (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,
    sent_at FLOAT8 NOT NULL,
    PRIMARY KEY (user_id, day)
  )`,
];

/** Which notifications a person gets, and how. */
export const DEFAULT_PREFS = {
  assigned: true,    // someone assigns you a task
  status: true,      // someone moves a task you're assigned
  completed: true,   // someone completes a task you created
  due: true,         // due-date reminders for your tasks
  leads: true,       // lead assigned to you, and your lead follow-ups
  emailInstant: true, // email me right away for things people do
  emailDigest: true,  // daily summary email at 7am
};
const BOOL_KEYS = Object.keys(DEFAULT_PREFS);
const INSTANT_EMAIL_TYPES = new Set(["assigned", "status", "completed", "lead"]);
const STATUS_LABEL = { todo: "To Do", doing: "In Progress", review: "Review", done: "Done" };
export const LEAD_OPEN = ["New", "Contacted", "Discovery booked", "Discovery done", "Proposal sent", "Nurture"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_DAYS = 60;
const DUE_CHECK_EVERY_MS = 10 * 60000;
export const DEFAULT_TZ = "America/New_York";

export const prefsOf = (row) => {
  const raw = typeof row?.prefs === "string" ? JSON.parse(row.prefs) : row?.prefs ?? {};
  return { ...DEFAULT_PREFS, tz: DEFAULT_TZ, ...raw };
};
export const validTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const quote = (s) => `“${s.length > 80 ? s.slice(0, 77) + "…" : s}”`;
const leadLabel = (d) => [d.name, d.company].filter(Boolean).join(" · ") || "a lead";
const row = (r) => ({ id: r.id, type: r.type, taskId: r.task_id ?? "", link: r.link ?? "", title: r.title, body: r.body, createdAt: r.created_at, read: r.read_at != null });

/** @param {import("./sql.js").Sql} sql */
export function createNotifications(sql, { send = sendEmail } = {}) {
  const lastDueCheck = new Map(); // userId -> { at, today }, per server instance

  async function usersNamed(name) {
    if (!name?.trim()) return [];
    return sql.query("SELECT id, name, email, prefs FROM users WHERE lower(name) = lower($1)", [name.trim()]);
  }

  /** Stores a notification (once per dedupe key) and, for things people did, emails it if wanted. */
  async function notify(user, n) {
    const inserted = await sql.query(
      `INSERT INTO notifications (id, user_id, type, task_id, title, body, link, dedupe_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
      [randomUUID(), user.id, n.type, n.taskId ?? null, n.title, n.body ?? "", n.link ?? "", n.dedupeKey ?? null, Date.now()]);
    if (!inserted.length) return false;
    const prefs = prefsOf(user);
    if (prefs.emailInstant && INSTANT_EMAIL_TYPES.has(n.type) && user.email) {
      const href = n.link ? appUrl() + n.link : appUrl();
      const { html, text } = layout({ heading: n.title, intro: n.body ? n.body[0].toUpperCase() + n.body.slice(1) + "." : "", button: { label: n.link ? "Open Lead Desk" : "Open Workboard", href } });
      await send({ to: user.email, subject: n.title.replace(/[“”]/g, '"'), html, text });
    }
    return true;
  }

  /** Removes unread reminders for an item that no longer apply (date moved, item done or deleted). */
  async function pruneReminders(itemId, types, keepKey) {
    await sql.query(
      `DELETE FROM notifications WHERE task_id = $1 AND type = ANY($2::text[]) AND read_at IS NULL
       AND ($3::text IS NULL OR dedupe_key NOT LIKE $3)`,
      [itemId, types, keepKey]);
  }

  return {
    async getPrefs(userId) {
      const [r] = await sql.query("SELECT prefs FROM users WHERE id = $1", [userId]);
      return prefsOf(r);
    },
    async setPrefs(userId, input) {
      const next = await this.getPrefs(userId);
      for (const k of BOOL_KEYS) {
        if (k in (input ?? {})) {
          if (typeof input[k] !== "boolean") throw new ValidationError(`Setting "${k}" must be on or off`);
          next[k] = input[k];
        }
      }
      if ("tz" in (input ?? {})) {
        if (typeof input.tz !== "string" || !validTz(input.tz)) throw new ValidationError("Unknown time zone");
        next.tz = input.tz;
      }
      await sql.query("UPDATE users SET prefs = $1::jsonb WHERE id = $2", [JSON.stringify(next), userId]);
      return next;
    },

    /** Called after a task is created or changed by `actor`. */
    async onTaskChange(actor, before, after, project) {
      if (!after) return;
      const where = project?.name ? `in ${project.name}` : "";
      const norm = (s) => (s || "").trim().toLowerCase();
      const newAssignee = after.assignee && (!before || norm(before.assignee) !== norm(after.assignee));
      const assignees = await usersNamed(after.assignee);
      for (const u of assignees) {
        if (u.id === actor.id) continue;
        const prefs = prefsOf(u);
        if (newAssignee) {
          if (prefs.assigned) await notify(u, { type: "assigned", taskId: after.id, title: `${actor.name} assigned you ${quote(after.title)}`, body: where });
        } else if (before && before.status !== after.status && prefs.status) {
          await notify(u, { type: "status", taskId: after.id, title: `${actor.name} moved ${quote(after.title)} to ${STATUS_LABEL[after.status]}`, body: where });
        }
      }
      // Tell the person who created the task when someone else finishes it.
      if (before && before.status !== "done" && after.status === "done" && after.createdBy && after.createdBy !== actor.id
          && !assignees.some((u) => u.id === after.createdBy)) {
        const [creator] = await sql.query("SELECT id, name, email, prefs FROM users WHERE id = $1", [after.createdBy]);
        if (creator && prefsOf(creator).completed) {
          await notify(creator, { type: "completed", taskId: after.id, title: `${actor.name} completed ${quote(after.title)}`, body: where });
        }
      }
      // Withdraw reminders that no longer apply.
      if (before && (after.status === "done" || before.due !== after.due || norm(before.assignee) !== norm(after.assignee))) {
        await pruneReminders(after.id, ["due"], after.status === "done" || !after.due ? null : `%:${after.id}:${after.due}`);
      }
    },

    async onTaskDelete(taskId) {
      await sql.query("DELETE FROM notifications WHERE task_id = $1 AND read_at IS NULL", [taskId]);
    },

    /** Called after a Lead Desk lead is saved (`before` is null for a new lead). */
    async onLeadChange(actor, id, before, after) {
      if (!after) return;
      const norm = (s) => (s || "").trim().toLowerCase();
      if (after.owner && (!before || norm(before.owner) !== norm(after.owner))) {
        for (const u of await usersNamed(after.owner)) {
          if (u.id === actor.id || !prefsOf(u).leads) continue;
          const what = [after.subService || after.category, after.ask].filter(Boolean).join(" — ");
          await notify(u, { type: "lead", taskId: id, link: "/leads/", title: `${actor.name} assigned you the lead ${quote(leadLabel(after))}`, body: what ? `about ${what}` : "" });
        }
      }
      if (before && (before.nextFollowUp !== after.nextFollowUp || !LEAD_OPEN.includes(after.stage) || norm(before.owner) !== norm(after.owner))) {
        await pruneReminders(id, ["leaddue"], LEAD_OPEN.includes(after.stage) && after.nextFollowUp ? `%:${id}:${after.nextFollowUp}` : null);
      }
    },
    async onLeadDelete(id) {
      await sql.query("DELETE FROM notifications WHERE task_id = $1 AND read_at IS NULL", [id]);
    },

    /** Creates reminders for the user's open tasks and lead follow-ups (at most every 10 min per user). */
    async ensureDueReminders(user, today, { force = false } = {}) {
      if (!DATE_RE.test(String(today))) return;
      const last = lastDueCheck.get(user.id);
      if (!force && last && last.today === today && Date.now() - last.at < DUE_CHECK_EVERY_MS) return;
      lastDueCheck.set(user.id, { at: Date.now(), today });
      const [me] = await sql.query("SELECT id, name, email, prefs FROM users WHERE id = $1", [user.id]);
      if (!me) return;
      const prefs = prefsOf(me);
      const tomorrow = addDays(today, 1);
      if (prefs.due) {
        const tasks = await sql.query(
          `SELECT id, title, due FROM tasks WHERE lower(assignee) = lower($1) AND status <> 'done' AND due <> '' AND due <= $2`,
          [me.name, tomorrow]);
        for (const t of tasks) {
          const kind = t.due < today ? "overdue" : t.due === today ? "today" : "soon";
          const title = kind === "overdue" ? `${quote(t.title)} is overdue` : kind === "today" ? `${quote(t.title)} is due today` : `${quote(t.title)} is due tomorrow`;
          await notify(me, { type: "due", taskId: t.id, title, body: kind === "overdue" ? `It was due ${fmtDay(t.due)}` : "", dedupeKey: `${kind}:${t.id}:${t.due}` });
        }
      }
      if (prefs.leads) {
        const leads = await sql.query(
          `SELECT id, data FROM documents WHERE collection = 'leads'
           AND lower(data->>'owner') = lower($1) AND data->>'stage' = ANY($2::text[])
           AND coalesce(data->>'nextFollowUp', '') <> '' AND data->>'nextFollowUp' <= $3`,
          [me.name, LEAD_OPEN, tomorrow]);
        for (const l of leads) {
          const d = typeof l.data === "string" ? JSON.parse(l.data) : l.data;
          const due = d.nextFollowUp;
          const kind = due < today ? "overdue" : due === today ? "today" : "soon";
          const title = kind === "overdue" ? `Follow-up with ${quote(leadLabel(d))} is overdue` : kind === "today" ? `Follow up with ${quote(leadLabel(d))} today` : `Follow up with ${quote(leadLabel(d))} tomorrow`;
          await notify(me, { type: "leaddue", taskId: l.id, link: "/leads/", title, body: kind === "overdue" ? `It was due ${fmtDay(due)}` : d.stage, dedupeKey: `lead-${kind}:${l.id}:${due}` });
        }
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
