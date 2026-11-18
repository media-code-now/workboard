// Appearance setting, kept per device. "system" follows the operating system.
export type Theme = "system" | "light" | "dark";

export function getTheme(): Theme {
  try { const t = localStorage.getItem("wb.theme"); if (t === "light" || t === "dark") return t; } catch { /* storage unavailable */ }
  return "system";
}
export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
}
export function setTheme(t: Theme) {
  try { if (t === "system") localStorage.removeItem("wb.theme"); else localStorage.setItem("wb.theme", t); } catch { /* ignore */ }
  applyTheme(t);
}

// Desktop (browser) alerts, also per device.
export function desktopAlertsOn(): boolean {
  try { return localStorage.getItem("wb.desktopAlerts") === "1"; } catch { return false; }
}
export function setDesktopAlerts(on: boolean) {
  try { if (on) localStorage.setItem("wb.desktopAlerts", "1"); else localStorage.removeItem("wb.desktopAlerts"); } catch { /* ignore */ }
}
