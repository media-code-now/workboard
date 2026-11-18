// Outgoing email through Resend (https://resend.com).
//
// Configure with RESEND_API_KEY and EMAIL_FROM (e.g. "Workboard <workboard@yourdomain.com>",
// on a domain verified in Resend). Without them, emails are skipped and the app works as before.
// Sending never throws: a failed email must not fail the change that triggered it.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function emailConfigured(env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/** The public address of the app, for links in emails. Netlify sets URL automatically. */
export function appUrl(env = process.env) {
  return (env.APP_URL || env.URL || "https://timeworkboard.netlify.app").replace(/\/+$/, "");
}

/**
 * @param {{ to: string, subject: string, html: string, text: string }} msg
 * @returns {Promise<{ sent: boolean, id?: string, error?: string, skipped?: string }>}
 */
export async function sendEmail(msg, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!emailConfigured(env)) return { sent: false, skipped: "Email isn't set up on the server (RESEND_API_KEY and EMAIL_FROM)." };
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data?.message || `Resend returned ${res.status}`;
      console.error("Email failed:", error);
      return { sent: false, error };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.error("Email failed:", e?.message || e);
    return { sent: false, error: String(e?.message || e) };
  }
}

/** A simple, readable email layout used by every Workboard email. */
export function layout({ heading, intro = "", sections = [], button, footer }) {
  const url = appUrl();
  const sectionHtml = sections.map((s) => `
      <tr><td style="padding:18px 0 6px;font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">${esc(s.title)}</td></tr>
      ${s.items.map((i) => `<tr><td style="padding:8px 0;border-top:1px solid #eceef2;font:15px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827">
        <span style="${i.urgent ? "color:#d0302a;font-weight:600" : ""}">${esc(i.title)}</span>${i.meta ? `<br><span style="font-size:13px;color:#6b7280">${esc(i.meta)}</span>` : ""}</td></tr>`).join("")}`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
    <tr><td style="font:700 13px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;letter-spacing:.06em;text-transform:uppercase;padding-bottom:14px">Workboard · AI SEO Agents</td></tr>
    <tr><td style="font:700 22px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827">${esc(heading)}</td></tr>
    ${intro ? `<tr><td style="padding-top:8px;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#374151">${esc(intro)}</td></tr>` : ""}
    ${sectionHtml}
    <tr><td style="padding-top:24px"><a href="${esc(button?.href || url)}" style="display:inline-block;background:#007aff;color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:13px 20px;border-radius:10px">${esc(button?.label || "Open Workboard")}</a></td></tr>
    <tr><td style="padding-top:24px;font:12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9ca3af">${esc(footer || "You can change which emails you get in Workboard → Settings.")}</td></tr>
  </table></body></html>`;
  const text = [heading, intro, ...sections.flatMap((s) => [``, s.title.toUpperCase(), ...s.items.map((i) => `- ${i.title}${i.meta ? ` (${i.meta})` : ""}`)]), ``, `${button?.label || "Open Workboard"}: ${button?.href || url}`, ``, footer || "Change which emails you get in Workboard → Settings."]
    .filter((l) => l !== undefined).join("\n");
  return { html, text };
}
