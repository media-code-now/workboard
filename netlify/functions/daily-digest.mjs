// Netlify Scheduled Function: every hour, sends the 7am daily summary to anyone
// whose local time has reached 7am and who hasn't had today's yet.
export const config = { schedule: "@hourly" };

export default async () => {
  try {
    const [{ init }, { runDigest }] = await Promise.all([import("../../server/init.js"), import("../../server/digest.js")]);
    const { sql } = await init();
    const r = await runDigest(sql);
    console.log(`Daily summary: sent ${r.sent.length}, skipped ${r.skipped}${r.configured ? "" : " (email not configured)"}`);
    return new Response(null, { status: 204 });
  } catch (e) {
    console.error("Daily summary failed:", String(e?.message || e).replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://***"));
    return new Response(null, { status: 500 });
  }
};
