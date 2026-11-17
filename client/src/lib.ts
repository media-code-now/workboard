import { COLORS, type Project, type Task } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parseDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (n: number, from?: string) => { const d = from ? parseDate(from) : new Date(); d.setDate(d.getDate() + n); return iso(d); };
export const dayDiff = (a: string, b: string) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);

export function fmtDate(s: string) {
  if (!s) return "";
  const diff = dayDiff(today(), s);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const dt = parseDate(s);
  return dt.toLocaleDateString(undefined, dt.getFullYear() === new Date().getFullYear()
    ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
export const fmtShort = (s: string) => parseDate(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function dueClass(t: Task): "" | "over" | "soon" {
  if (!t.due || t.status === "done") return "";
  if (t.due < today()) return "over";
  if (t.due <= addDays(3)) return "soon";
  return "";
}

export const initials = (n: string) =>
  n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
export const personColor = (n: string) => `var(--${COLORS[hash(n) % COLORS.length]})`;
export const projectColor = (p?: Project) => `var(--${p?.color ?? "blue"})`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
