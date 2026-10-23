import { useState } from "react";
import { startGoogleLogin, useAuth } from "../auth";
import { config } from "../config";
import { ErrorBox } from "../components";
import SignUp from "./SignUp";
import { AuthShell } from "../brand";

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<null | ((pw: string) => Promise<void>)>(null); const [np, setNp] = useState("");
  if (mode === "up") return <SignUp onBack={() => setMode("in")} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (challenge) { await challenge(np); return; }
      const r = await login(email.trim(), pw);
      if ("newPassword" in r) setChallenge(() => r.complete);
    } catch (x: any) { setErr(x?.message ?? x); } finally { setBusy(false); }
  };
  return (
    <AuthShell><form className="card login" onSubmit={submit}>
      <h1>{challenge ? "Set a new password" : "Welcome back"}</h1><p className="muted">Sign in to MedSync to manage medicines, appointments and refills.</p>
      {!challenge ? <>
        <label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <label className="gap">Password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" />
      </> : <><p>Set a new password (min 12 characters, upper/lower case, number, symbol).</p>
        <input type="password" value={np} onChange={(e) => setNp(e.target.value)} required minLength={12} autoComplete="new-password" /></>}
      <ErrorBox e={err} />
      <button className="primary gap" disabled={busy}>{busy ? "Please wait…" : challenge ? "Set password" : "Sign in"}</button>
      {!challenge && <>
        {config().googleEnabled && <button type="button" className="gap google" onClick={() => startGoogleLogin()}>Continue with Google</button>}
        <button type="button" className="sm gap" onClick={() => setMode("up")}>New here? Create an account</button>
      </>}
    </form></AuthShell>
  );
}
