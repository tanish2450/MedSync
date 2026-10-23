import { useState } from "react";
import { useAuth } from "../auth";
import { ErrorBox } from "../components";
import { AuthShell } from "../brand";
import ProfileForm, { type SignupRole } from "./ProfileForm";

export const ROLE_CARDS: { role: SignupRole; title: string; blurb: string }[] = [
  { role: "patient", title: "Patient", blurb: "Track medicines, get reminders, book doctors." },
  { role: "doctor", title: "Doctor", blurb: "Prescribe safely and follow your patients' adherence." },
  { role: "pharmacy", title: "Pharmacy", blurb: "List your store so patients can find you." },
  { role: "caregiver", title: "Caregiver", blurb: "Help a family member stay on track." },
];

/** Shown to anyone signed in without a role yet (new email sign-up or Google): pick a role, then fill that role's required details. */
export function FinishProfile() {
  const { me, logout } = useAuth();
  const [role, setRole] = useState<SignupRole | null>(null);
  return (
    <AuthShell wide><div className="narrow">
      <h1>Finish setting up your account</h1>
      <p className="muted">Signed in as {me?.email}. Tell us who you are so we can ask for the right details.</p>
      {!role ? <div className="rolecards">{ROLE_CARDS.map((c) => (
        <button key={c.role} type="button" className="card rolecard" onClick={() => setRole(c.role)}><b>{c.title}</b><span className="muted">{c.blurb}</span></button>))}</div>
        : <><button className="sm" onClick={() => setRole(null)}>← Change role</button><h2>{ROLE_CARDS.find((c) => c.role === role)!.title} details</h2><ProfileForm role={role} defaultName={me?.name !== me?.email ? me?.name : ""} /></>}
      <button className="sm gap" onClick={logout}>Sign out</button>
    </div></AuthShell>
  );
}

/** Email sign-up: account -> emailed code -> auto sign-in -> FinishProfile (App shows it because the new user has no role). */
export default function SignUp({ onBack }: { onBack: () => void }) {
  const { signUp, confirmSignUp, resendCode, login } = useAuth();
  const [step, setStep] = useState<"account" | "code">("account");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [code, setCode] = useState("");
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState("");
  const strong = pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (x: any) { setErr(x?.message ?? x); } finally { setBusy(false); } };

  return (
    <AuthShell><form className="card login" onSubmit={(e) => { e.preventDefault(); run(async () => {
      if (step === "account") {
        if (!strong) throw new Error("Password needs 12+ characters with upper and lower case, a number and a symbol.");
        if (pw !== pw2) throw new Error("Passwords do not match.");
        await signUp(email.trim().toLowerCase(), pw, name.trim()); setStep("code");
      } else { await confirmSignUp(email.trim().toLowerCase(), code); await login(email.trim().toLowerCase(), pw); }
    }); }}>
      <h1>Create your account</h1>
      {step === "account" ? <>
        <label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />
        <label className="gap">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <label className="gap">Password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" />
        <small className={strong || !pw ? "muted" : "err"}>12+ characters, upper and lower case, number and symbol.</small>
        <label className="gap">Confirm password</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
      </> : <>
        <p>We emailed a 6-digit code to <b>{email}</b>. Enter it to verify your address.</p>
        <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="123456" autoComplete="one-time-code" />
        <button type="button" className="sm gap" onClick={() => run(async () => { await resendCode(email.trim().toLowerCase()); setNote("A new code is on its way."); })}>Resend code</button>
        {note && <small className="muted">{note}</small>}
      </>}
      <ErrorBox e={err} />
      <button className="primary gap" disabled={busy}>{busy ? "Please wait…" : step === "account" ? "Continue" : "Verify and continue"}</button>
      <button type="button" className="sm gap" onClick={onBack}>I already have an account</button>
    </form></AuthShell>
  );
}
