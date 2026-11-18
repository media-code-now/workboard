import { useEffect, useState } from "react";
import { api } from "../api";
import type { NotificationPrefs, Settings, User } from "../types";
import { desktopAlertsOn, getTheme, setDesktopAlerts, setTheme, type Theme } from "../theme";
import { Avatar, Icon, Sheet } from "./ui";

function Toggle({ id, label, hint, checked, disabled, onChange }: {
  id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="frow toggle-row" htmlFor={id}>
      <span className="tg-txt"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <input id={id} type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

type BoolPref = Exclude<keyof NotificationPrefs, "tz">;
const PREF_ROWS: { key: BoolPref; label: string; hint: string }[] = [
  { key: "assigned", label: "Assigned to me", hint: "When someone gives you a task" },
  { key: "status", label: "Changes to my tasks", hint: "When someone moves a task you're assigned" },
  { key: "completed", label: "Finished work", hint: "When someone completes a task you created" },
  { key: "due", label: "Due-date reminders", hint: "The day before, on the day, and when overdue" },
  { key: "leads", label: "Leads", hint: "A lead assigned to you, and your follow-ups in Lead Desk" },
];

export function SettingsSheet({ open, user, onClose, onUserChange, onPassword, onTeam, onSignOut, notify }: {
  open: boolean; user: User; onClose: () => void;
  onUserChange: (u: User) => void; onPassword: () => void; onTeam: () => void; onSignOut: () => void;
  notify: (msg: string) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [alerts, setAlerts] = useState(desktopAlertsOn);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "Notification" in window ? Notification.permission : "unsupported");

  useEffect(() => {
    if (!open) return;
    setError(null); setName(user.name); setThemeState(getTheme()); setAlerts(desktopAlertsOn());
    api.settings().then((s) => { setSettings(s); setName(s.name); }).catch((e) => setError((e as Error).message));
  }, [open, user.name]);

  const saveName = async () => {
    if (!name.trim()) { setError("Enter your name."); return; }
    if (name.trim() === settings?.name) return;
    setBusy(true); setError(null);
    try {
      const s = await api.updateSettings({ name });
      setSettings(s); setName(s.name);
      onUserChange({ ...user, name: s.name });
      notify("Name updated");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const [emailBusy, setEmailBusy] = useState<"" | "test" | "digest">("");
  const sendCheck = async (kind: "test" | "digest") => {
    setEmailBusy(kind); setError(null);
    try {
      const r = kind === "test" ? await api.emailTest() : await api.emailDigest();
      notify(kind === "test" ? `Test email sent to ${r.to}` : `Today's summary sent to ${r.to}`);
    } catch (e) { setError((e as Error).message); }
    finally { setEmailBusy(""); }
  };
  const setPref = async (key: BoolPref, value: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, prefs: { ...settings.prefs, [key]: value } }); // optimistic
    try { setSettings(await api.updateSettings({ prefs: { [key]: value } })); }
    catch (e) { setError((e as Error).message); setSettings(settings); }
  };

  const toggleAlerts = async (on: boolean) => {
    if (on && "Notification" in window && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") { setAlerts(false); setDesktopAlerts(false); return; }
    }
    setAlerts(on); setDesktopAlerts(on);
    if (on) notify("Desktop alerts on");
  };

  const pickTheme = (t: Theme) => { setThemeState(t); setTheme(t); };

  return (
    <Sheet open={open} onClose={onClose} title="Settings" canSave={false}>
      <div className="form-group me-card">
        <Avatar name={settings?.name || user.name} />
        <div className="me-txt"><b>{settings?.name || user.name}</b><small>{user.email} · {user.role === "admin" ? "Admin" : "Member"}</small></div>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Profile</div>
        <div className="form-group">
          <div className="frow"><label htmlFor="stName">Name</label>
            <input id="stName" value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
              onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } }} disabled={busy} /></div>
          <div className="frow"><label>Email</label><input value={user.email} readOnly tabIndex={-1} aria-label="Email" /></div>
        </div>
        <p className="hint">Tasks are assigned by name, so changing it also updates your tasks and projects.</p>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Notify me about</div>
        <div className="form-group">
          {PREF_ROWS.map((r) => (
            <Toggle key={r.key} id={`pref-${r.key}`} label={r.label} hint={r.hint}
              checked={settings?.prefs[r.key] ?? true} disabled={!settings} onChange={(v) => setPref(r.key, v)} />
          ))}
        </div>
        <div className="form-group">
          <Toggle id="pref-desktop" label="Desktop alerts" checked={alerts && permission === "granted"} disabled={permission === "unsupported" || permission === "denied"}
            hint={permission === "unsupported" ? "This browser doesn't support them"
              : permission === "denied" ? "Blocked in your browser's site settings"
              : "Pop-up alerts on this device when Workboard isn't in front"}
            onChange={toggleAlerts} />
        </div>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Email</div>
        {settings && !settings.emailConfigured && (
          <p className="hint warn-hint">Email isn't connected yet, so nothing is sent. An admin adds the email service in Netlify (see the README, "Email").</p>
        )}
        <div className="form-group">
          <Toggle id="pref-emailInstant" label="Email me right away" hint="For the notifications above that someone else causes"
            checked={settings?.prefs.emailInstant ?? true} disabled={!settings} onChange={(v) => setPref("emailInstant", v)} />
          <Toggle id="pref-emailDigest" label="Daily summary at 7am" hint={`Overdue and upcoming tasks, lead follow-ups${settings?.prefs.tz ? ` · ${settings.prefs.tz.replace(/_/g, " ")} time` : ""}`}
            checked={settings?.prefs.emailDigest ?? true} disabled={!settings} onChange={(v) => setPref("emailDigest", v)} />
        </div>
        <div className="email-acts">
          <button type="button" className="capsule glass" disabled={!settings?.emailConfigured || !!emailBusy} onClick={() => sendCheck("test")}>{emailBusy === "test" ? "Sending…" : "Send test email"}</button>
          <button type="button" className="capsule glass" disabled={!settings?.emailConfigured || !!emailBusy} onClick={() => sendCheck("digest")}>{emailBusy === "digest" ? "Sending…" : "Send today's summary now"}</button>
        </div>
        <p className="hint">Emails go to {user.email}.</p>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Appearance</div>
        <div className="view-pick">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => pickTheme(t)}>
              <span className={"theme-chip " + t} aria-hidden="true" /><span>{t[0].toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="menu-sec">
        <div className="menu-h">Account</div>
        <div className="form-group">
          <button type="button" className="mrow" onClick={onPassword}><span className="mico" style={{ background: "var(--label-3)" }}><Icon name="dots" width={2} /></span>Change Password</button>
          {user.role === "admin" && <button type="button" className="mrow" onClick={onTeam}><span className="mico" style={{ background: "var(--green)" }}><Icon name="people" width={2} /></span>Team</button>}
        </div>
        <div className="form-group"><button type="button" className="mrow danger" onClick={onSignOut}>Sign Out</button></div>
      </div>

      {error && <p className="err" role="alert">{error}</p>}
    </Sheet>
  );
}
