import { useCallback, useEffect, useState } from "react";
import { ApiError, SIGNED_OUT_EVENT, api } from "./api";
import type { User } from "./types";
import { Login } from "./components/Login";
import App from "./App";

/** After sign-in, go back to the Leads page if that's where the person came from. */
function nextPath(): string | null {
  const n = new URLSearchParams(location.search).get("next");
  return n && /^\/leads\/?$/.test(n) ? n : null;
}

type State = { status: "checking" } | { status: "signed-out"; notice?: string } | { status: "signed-in"; user: User } | { status: "error"; message: string };

export default function AuthGate() {
  const [state, setState] = useState<State>({ status: "checking" });

  const check = useCallback(async () => {
    setState({ status: "checking" });
    try {
      const user = await api.me();
      const next = nextPath();
      if (next) { location.replace(next); return; }
      setState({ status: "signed-in", user });
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ status: "signed-out" });
      else setState({ status: "error", message: (e as Error).message });
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    const onExpired = () => setState((s) => (s.status === "signed-in" ? { status: "signed-out", notice: "Your session ended. Please sign in again." } : s));
    window.addEventListener(SIGNED_OUT_EVENT, onExpired);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onExpired);
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* the cookie is cleared server-side when reachable; show sign-in either way */ }
    setState({ status: "signed-out", notice: "You've signed out." });
  }, []);

  switch (state.status) {
    case "checking":
      return <><div className="wall" aria-hidden="true"><i /><i /><i /></div><main className="login-wrap"><p className="login-sub" role="status">Loading…</p></main></>;
    case "error":
      return (
        <><div className="wall" aria-hidden="true"><i /><i /><i /></div>
          <main className="login-wrap"><div className="login glass">
            <h1>Workboard</h1><p className="err" role="alert">{state.message}</p>
            <button type="button" className="login-btn" onClick={check}>Try Again</button>
          </div></main></>
      );
    case "signed-out":
      return <Login notice={state.notice} onSignedIn={(user) => {
        const next = nextPath();
        if (next) location.replace(next); else setState({ status: "signed-in", user });
      }} />;
    case "signed-in":
      return <App user={state.user} onSignOut={signOut} onUserChange={(user) => setState({ status: "signed-in", user })} />;
  }
}
