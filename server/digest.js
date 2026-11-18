// Daily summary email: sent once per person per day, at 7am in their own time zone
// (from Settings; New York until their browser reports one). A scheduled function
// runs this every hour; it's safe to run more often.
import { DEFAULT_TZ, LEAD_OPEN, addDays, fmtDay, prefsOf } from "./notifications.js";
import { appUrl, emailConfigured, layout, sendEmail } from "./email.js";

export const DIGEST_HOUR = 7;

/** Local date (YYYY-MM-DD) and hour for a time zone. */
export function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** What would go in one person's summary for `today` (their local date). */
export async function buildDigest(sql, user, today) {
  const tomorrow = addDays(today, 1);
  const tasks = await sql.query(
    `SELECT t.title, t.due, t.status, p.name AS project FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE lower(t.assignee) = lower($1) AND t.status <> 'done' AND t.due <> '' AND t.due <= $2 ORDER BY t.due`,
    [user.name, tomorrow]);
  const leads = await sql.query(
    `SELECT data FROM documents WHERE collection = 'leads' AND lower(data->>'owner') = lower($1)
     AND data->>'stage' = ANY($2::text[]) AND coalesce(data->>'nextFollowUp', '') <> '' AND data->>'nextFollowUp' <= $3
     ORDER BY data->>'nextFollowUp'`,
    [user.name, LEAD_OPEN, today]);
  const [{ n: unread }] = await sql.query("SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [user.id]);
  const item = (t) => ({ title: t.title, meta: [t.project, t.due < today ? `was due ${fmtDay(t.due)}` : null].filter(Boolean).join(" · "), urgent: t.due < today });
  const sections = [
    { title: "Overdue", items: tasks.filter((t) => t.due < today).map(item) },
    { title: "Due today", items: tasks.filter((t) => t.due === today).map(item) },
    { title: "Due tomorrow", items: tasks.filter((t) => t.due === tomorrow).map(item) },
    { title: "Lead follow-ups", items: leads.map((r) => {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      return { title: [d.name, d.company].filter(Boolean).join(" · "), meta: [d.stage, d.nextFollowUp < today ? `was due ${fmtDay(d.nextFollowUp)}` : "today", d.phone || d.email].filter(Boolean).join(" · "), urgent: d.nextFollowUp < today };
    }) },
  ].filter((s) => s.items.length);
  return { sections, unread, empty: !sections.length && !unread };
}

/**
 * Sends today's summary to everyone whose local time has reached 7am and who hasn't had one today.
 * @returns {Promise<{ sent: string[], skipped: number }>}
 */
export async function runDigest(sql, { now = new Date(), force = false, onlyUserId = null, send = sendEmail } = {}) {
  const result = { sent: [], skipped: 0, configured: emailConfigured() };
  const users = await sql.query("SELECT id, name, email, prefs FROM users" + (onlyUserId ? " WHERE id = $1" : ""), onlyUserId ? [onlyUserId] : []);
  for (const u of users) {
    const prefs = prefsOf(u);
    const { day, hour } = localNow(prefs.tz, now);
    if (!force && (!prefs.emailDigest || hour < DIGEST_HOUR)) { result.skipped++; continue; }
    // Claim today's slot first so overlapping runs never send twice.
    if (!force) {
      const claimed = await sql.query("INSERT INTO digest_log (user_id, day, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING day", [u.id, day, Date.now()]);
      if (!claimed.length) { result.skipped++; continue; }
    }
    const d = await buildDigest(sql, u, day);
    if (d.empty && !force) { result.skipped++; continue; }
    const longDate = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    const count = d.sections.reduce((n, s) => n + s.items.length, 0);
    const { html, text } = layout({
      heading: `Your day, ${longDate}`,
      intro: d.empty ? "Nothing is due and you're all caught up." : `${count ? `${count} item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your attention` : "Nothing is due today"}${d.unread ? `, and you have ${d.unread} unread notification${d.unread === 1 ? "" : "s"}` : ""}.`,
      sections: d.sections,
      button: { label: "Open Workboard", href: appUrl() },
      footer: "Daily summary at 7am. Turn it off in Workboard → Settings.",
    });
    const r = await send({ to: u.email, subject: d.empty ? "Workboard: you're all caught up" : `Workboard: ${count || d.unread} thing${(count || d.unread) === 1 ? "" : "s"} for ${longDate.split(",")[0]}`, html, text });
    if (r.sent) result.sent.push(u.email);
    else {
      result.skipped++;
      if (!force) await sql.query("DELETE FROM digest_log WHERE user_id = $1 AND day = $2", [u.id, day]); // retry next run
    }
  }
  return result;
}
