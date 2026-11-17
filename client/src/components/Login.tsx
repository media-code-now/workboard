import { useState } from "react";
import { api } from "../api";
import type { User } from "../types";

export function Login({ onSignedIn, notice }: { onSignedIn: (u: User) => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError(null);
    try { onSignedIn(await api.login(email, password)); }
    catch (err) { setError((err as Error).message); setPassword(""); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="wall" aria-hidden="true"><i /><i /><i /></div>
      <main className="login-wrap">
        <form className="login glass" onSubmit={submit} noValidate>
          <div className="login-mark" aria-hidden="true"><i /><i /><i /></div>
          <h1>Workboard</h1>
          <p className="login-sub">Sign in to see your team's projects and tasks.</p>
          {notice && !error && <p className="login-note" role="status">{notice}</p>}
          <div className="form-group">
            <div className="frow">
              <label htmlFor="lEmail">Email</label>
              <input id="lEmail" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
            </div>
            <div className="frow">
              <label htmlFor="lPass">Password</label>
              <input id="lPass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Required" />
            </div>
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          <button type="submit" className="login-btn" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
          <p className="login-help">No account or forgot your password? Ask your Workboard admin.</p>
        </form>
      </main>
    </>
  );
}
