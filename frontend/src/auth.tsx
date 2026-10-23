import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AuthenticationDetails, CognitoUser, CognitoUserAttribute, CognitoUserPool, type CognitoUserSession } from "amazon-cognito-identity-js";
import { config } from "./config";

export type Role = "admin_nurse" | "doctor" | "patient" | "caregiver" | "pharmacy";
const ROLE_LIST: Role[] = ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy"];
/** role is null for a brand-new self sign-up (email or Google) that has not finished its profile yet. */
export interface Me { sub: string; email: string; name: string; role: Role | null }

const pool = () => new CognitoUserPool({ UserPoolId: config().userPoolId, ClientId: config().clientId });

export function getIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const u = pool().getCurrentUser();
    if (!u) return resolve(null);
    u.getSession((err: Error | null, s: CognitoUserSession | null) => resolve(err || !s?.isValid() ? null : s.getIdToken().getJwtToken()));
  });
}
function decode(token: string): Me {
  const c = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  const groups: string[] = c["cognito:groups"] ?? [];
  const role = ROLE_LIST.find((r) => groups.includes(r)) ?? null;
  return { sub: c.sub, email: c.email, name: c.name ?? c.email, role };
}

// ---------- Google (Cognito hosted UI, authorization-code + PKCE; no client secret in the browser) ----------
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const redirectUri = () => `${location.origin}/`;
export async function startGoogleLogin(): Promise<void> {
  const cfg = config();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("pkce", verifier);
  const q = new URLSearchParams({ identity_provider: "Google", response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri(), scope: "openid email profile", code_challenge: challenge, code_challenge_method: "S256" });
  location.assign(`https://${cfg.cognitoDomain}/oauth2/authorize?${q}`);
}
/** If the page was opened by Google's redirect (?code=...), swap the code for tokens and store them where cognito-identity-js looks. */
async function finishGoogleLoginIfReturning(): Promise<string | null> {
  const code = new URLSearchParams(location.search).get("code");
  const verifier = sessionStorage.getItem("pkce");
  if (!code || !verifier || !config().cognitoDomain) return null;
  history.replaceState({}, "", location.pathname + location.hash);
  sessionStorage.removeItem("pkce");
  const r = await fetch(`https://${config().cognitoDomain}/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config().clientId, code, redirect_uri: redirectUri(), code_verifier: verifier }),
  });
  if (!r.ok) throw new Error("Google sign-in failed. Please try again.");
  const t = await r.json();
  const claims = JSON.parse(atob(t.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  const p = `CognitoIdentityServiceProvider.${config().clientId}`;
  const u = claims["cognito:username"];
  localStorage.setItem(`${p}.LastAuthUser`, u);
  localStorage.setItem(`${p}.${u}.idToken`, t.id_token);
  localStorage.setItem(`${p}.${u}.accessToken`, t.access_token);
  localStorage.setItem(`${p}.${u}.refreshToken`, t.refresh_token);
  localStorage.setItem(`${p}.${u}.clockDrift`, "0");
  return t.id_token as string;
}

type LoginResult = { ok: true } | { newPassword: true; complete: (pw: string) => Promise<void> };
interface AuthCtx {
  me: Me | null; ready: boolean;
  login: (email: string, pw: string) => Promise<LoginResult>;
  signUp: (email: string, pw: string, name: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  /** Re-read the token after the profile is created, so the new role group appears. */
  refresh: () => Promise<void>;
  logout: () => void;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try { await finishGoogleLoginIfReturning(); } catch { /* fall through to normal sign-in screen */ }
      const t = await getIdToken();
      if (t) try { setMe(decode(t)); } catch { /* bad token */ }
      setReady(true);
    })();
  }, []);

  const login = (email: string, password: string) => new Promise<LoginResult>((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: pool() });
    const finish = (s: CognitoUserSession) => { setMe(decode(s.getIdToken().getJwtToken())); };
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: (s) => { try { finish(s); resolve({ ok: true }); } catch (e) { reject(e); } },
      onFailure: (e) => reject(e),
      newPasswordRequired: () => resolve({
        newPassword: true,
        complete: (pw: string) => new Promise<void>((res, rej) => user.completeNewPasswordChallenge(pw, {}, {
          onSuccess: (s) => { finish(s); res(); }, onFailure: rej,
        })),
      }),
      totpRequired: () => reject(new Error("MFA codes are not yet supported in this UI; disable MFA for this user")),
      mfaRequired: () => reject(new Error("MFA codes are not yet supported in this UI; disable MFA for this user")),
    });
  });
  const signUp = (email: string, password: string, name: string) => new Promise<void>((res, rej) =>
    pool().signUp(email, password, [new CognitoUserAttribute({ Name: "email", Value: email }), new CognitoUserAttribute({ Name: "name", Value: name })], [], (e) => (e ? rej(e) : res())));
  const confirmSignUp = (email: string, code: string) => new Promise<void>((res, rej) =>
    new CognitoUser({ Username: email, Pool: pool() }).confirmRegistration(code.trim(), true, (e) => (e ? rej(e) : res())));
  const resendCode = (email: string) => new Promise<void>((res, rej) =>
    new CognitoUser({ Username: email, Pool: pool() }).resendConfirmationCode((e) => (e ? rej(e) : res())));
  const refresh = () => new Promise<void>((res, rej) => {
    const u = pool().getCurrentUser();
    if (!u) return rej(new Error("Not signed in"));
    u.getSession((err: Error | null, s: CognitoUserSession | null) => {
      if (err || !s) return rej(err ?? new Error("No session"));
      u.refreshSession(s.getRefreshToken(), (e2, s2: CognitoUserSession) => { if (e2) return rej(e2); setMe(decode(s2.getIdToken().getJwtToken())); res(); });
    });
  });
  const logout = () => { pool().getCurrentUser()?.signOut(); setMe(null); };
  return <Ctx.Provider value={{ me, ready, login, signUp, confirmSignUp, resendCode, refresh, logout }}>{children}</Ctx.Provider>;
}
