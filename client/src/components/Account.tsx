import { useEffect, useState } from "react";
import { api } from "../api";
import type { User } from "../types";
import { Avatar, Sheet } from "./ui";

export function PasswordSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setCurrent(""); setNext(""); setConfirm(""); setError(null); } }, [open]);

  const save = async () => {
    if (next.length < 10) { setError("Use at least 10 characters for the new password."); return; }
    if (next !== confirm) { setError("The new passwords don't match."); return; }
    setBusy(true); setError(null);
    try { await api.changePassword(current, next); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Change Password" onSubmit={save} canSave={!busy}>
      <input type="text" autoComplete="username" hidden readOnly />
      <div className="form-group">
        <div className="frow"><label htmlFor="pwCur">Current</label>
          <input id="pwCur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Required" /></div>
      </div>
      <div className="form-group">
        <div className="frow"><label htmlFor="pwNew">New</label>
          <input id="pwNew" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="10+ characters" /></div>
        <div className="frow"><label htmlFor="pwConf">Confirm</label>
          <input id="pwConf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat" /></div>
      </div>
      <p className="hint">You'll stay signed in here. Other devices are signed out.</p>
      {error && <p className="err" role="alert">{error}</p>}
    </Sheet>
  );
}

/** Admin-only team management: add people, reset passwords, remove accounts. */
export function TeamSheet({ open, me, onClose }: { open: boolean; me: User; onClose: () => void }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<User["role"]>("member");
  const [secret, setSecret] = useState<{ user: User; password: string; isNew: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSecret(null); setError(null); setConfirmRemove(null); setEmail(""); setName(""); setRole("member");
    api.listUsers().then(setUsers).catch((e) => setError((e as Error).message));
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const add = () => run(async () => {
    if (!name.trim() || !email.trim()) throw new Error("Enter a name and an email.");
    const r = await api.addUser({ email, name, role });
    setUsers((u) => [...(u ?? []), r.user]);
    setSecret({ user: r.user, password: r.temporaryPassword, isNew: true });
    setCopied(false); setEmail(""); setName(""); setRole("member");
  });
  const reset = (u: User) => run(async () => {
    const r = await api.resetUserPassword(u.id);
    setSecret({ user: r.user, password: r.temporaryPassword, isNew: false });
    setCopied(false);
  });
  const remove = (u: User) => run(async () => {
    await api.removeUser(u.id);
    setUsers((list) => (list ?? []).filter((x) => x.id !== u.id));
    setConfirmRemove(null);
  });
  const copy = async () => {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret.password); setCopied(true); } catch { /* selectable text is the fallback */ }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Team" canSave={false}>
      {secret && (
        <div className="secret" role="status">
          <b>{secret.isNew ? `${secret.user.name} can now sign in` : `New password for ${secret.user.name}`}</b>
          <span>Send them this temporary password privately. It won't be shown again.</span>
          <div className="secret-row">
            <code>{secret.password}</code>
            <button type="button" className="capsule glass" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <small>Sign-in email: {secret.user.email}</small>
        </div>
      )}

      <div className="menu-sec">
        <div className="menu-h">Add a person</div>
        <div className="form-group">
          <div className="frow"><label htmlFor="tmName">Name</label><input id="tmName" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Full name" /></div>
          <div className="frow"><label htmlFor="tmEmail">Email</label><input id="tmEmail" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></div>
          <div className="frow"><label htmlFor="tmRole">Role</label>
            <select id="tmRole" value={role} onChange={(e) => setRole(e.target.value as User["role"])}>
              <option value="member">Member</option><option value="admin">Admin</option>
            </select></div>
        </div>
        <button type="button" className="login-btn" onClick={add} disabled={busy}>Add to Team</button>
        <p className="hint">Admins can also manage the team. Members use the board.</p>
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      <div className="menu-sec">
        <div className="menu-h"><span>People</span><span>{users?.length ?? ""}</span></div>
        <div className="form-group">
          {!users && <div className="frow"><span className="hint">Loading…</span></div>}
          {users?.map((u) => (
            <div key={u.id} className="team-row">
              <Avatar name={u.name} />
              <div className="me-txt"><b>{u.name}{u.id === me.id ? " (you)" : ""}</b><small>{u.email} · {u.role === "admin" ? "Admin" : "Member"}</small></div>
              {u.id !== me.id && (confirmRemove === u.id ? (
                <div className="team-acts">
                  <button type="button" className="mini" onClick={() => setConfirmRemove(null)}>Keep</button>
                  <button type="button" className="mini danger" onClick={() => remove(u)} disabled={busy}>Remove</button>
                </div>
              ) : (
                <div className="team-acts">
                  <button type="button" className="mini" onClick={() => reset(u)} disabled={busy}>Reset password</button>
                  <button type="button" className="mini danger" onClick={() => setConfirmRemove(u.id)} aria-label={`Remove ${u.name}`}>Remove</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/** Desktop avatar button with the account popover. */
export function AccountMenu({ user, onSettings, onTeam, onSignOut }: { user: User; onSettings: () => void; onTeam: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as Element).closest(".account")) setOpen(false);
    };
    document.addEventListener("click", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="account">
      <button type="button" className="account-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${user.name}`} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user.name} />
      </button>
      {open && (
        <div className="account-pop glass" role="menu">
          <div className="who"><Avatar name={user.name} /><div><b>{user.name}</b><small>{user.email}</small></div></div>
          <button type="button" role="menuitem" className="pop-item" onClick={pick(onSettings)}>Settings</button>
          {user.role === "admin" && <button type="button" role="menuitem" className="pop-item" onClick={pick(onTeam)}>Team</button>}
          <button type="button" role="menuitem" className="signout" onClick={pick(onSignOut)}>Sign Out</button>
        </div>
      )}
    </div>
  );
}
