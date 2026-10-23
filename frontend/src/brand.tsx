import { useEffect, useState, type ReactNode } from "react";
import { DoctorPatient } from "./illustrations";

/** Rounded tile with a capsule-and-pulse mark, tinted by the role accent. */
export function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <rect x="6" y="11" width="20" height="10" rx="5" fill="#fff" opacity=".22" />
      <path d="M6 16h5l2.2-4.5L17 21l2.4-5H26" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export const Logo = () => <div className="logo"><LogoMark /><span>Med<b>Sync</b></span></div>;

const P: Record<string, ReactNode> = {
  home: <><path d="M3 11l9-8 9 8v10H3z" /><path d="M9 21v-6h6v6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17.5 14c2.4 0 4 1.8 4 4.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  pill: <><path d="M10.5 20.5a5 5 0 0 1-7-7l9-9a5 5 0 0 1 7 7z" /><path d="M8.5 8.5l7 7" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></>,
  bag: <><path d="M5 7h14l-1 13H6z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  heart: <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>,
  truck: <><path d="M2 6h12v10H2zM14 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  text: <path d="M4 19L9 5l5 14M6 14h6M16 19v-7M16 12c0-2 4-2 4 0v7" />,
  out: <><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  alert: <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4.5M12 17.5v.5" /></>,
};
export type IconName = keyof typeof P;
export const Icon = ({ n }: { n: IconName }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{P[n]}</svg>;

export const NAV_ICON: Record<string, IconName> = {
  "/": "home", "/find": "search", "/health": "heart", "/appointments": "calendar", "/caregivers": "users", "/prescriptions": "upload", "/orders": "bag",
  "/patients": "users", "/scans": "scan", "/availability": "clock", "/doctors": "user", "/confirmations": "check", "/pharmacies": "bag", "/messages": "chat",
};
export const navIcon = (path: string, role: string): IconName => (role === "caregiver" && path === "/" ? "heart" : role === "pharmacy" && path === "/" ? "truck" : NAV_ICON[path] ?? "home");

/** Light / dark theme, remembered per browser. Light is the default. */
export function useTheme() {
  const [t, setT] = useState<"dark" | "light">(() => { try { return localStorage.getItem("theme") === "dark" ? "dark" : "light"; } catch { return "light"; } });
  useEffect(() => { document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch { /* storage unavailable */ } }, [t]);
  return [t, () => setT(t === "dark" ? "light" : "dark")] as const;
}
/** Sets the role on <html> so the whole page (background, scrollbars, modals) takes that role's accent. */
export function useRoleSkin(role: string | null | undefined) {
  useEffect(() => { if (role) document.documentElement.dataset.role = role; else delete document.documentElement.dataset.role; return () => { delete document.documentElement.dataset.role; }; }, [role]);
}

/** Split-screen frame for sign in, sign up and finishing a profile. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="auth">
      <section className="art" aria-hidden={false}>
        <svg className="shapes" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <radialGradient id="ga"><stop offset="0" stopColor="var(--accent)" stopOpacity=".16" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
            <radialGradient id="gb"><stop offset="0" stopColor="var(--accent)" stopOpacity=".1" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
            <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="var(--line-2)" /></pattern>
          </defs>
          <rect width="600" height="800" fill="url(#dots)" opacity=".7" />
          <circle className="blob" cx="470" cy="170" r="230" fill="url(#ga)" />
          <circle className="blob b2" cx="90" cy="640" r="260" fill="url(#gb)" />
          <circle className="blob b3" cx="520" cy="700" r="140" fill="url(#ga)" />
        </svg>
        <Logo />
        <div className="preview" aria-hidden="true">
          <DoctorPatient />
          <div className="pc"><i><Icon n="check" /></i><div><b>Metformin 500 mg taken</b><small>8:02 am · on time</small></div></div>
        </div>
        <div>
          <h2>One plan.<br /><em>Every</em> doctor.<br /><span>Zero</span> missed doses.</h2>
          <p>MedSync keeps every prescription, reminder and refill in one place, and warns you before two medicines clash.</p>
          <div className="pts"><span>Interaction checks</span><span>Smart reminders</span><span>Pharmacy delivery</span></div>
        </div>
      </section>
      <section className="panel" style={wide ? { alignItems: "start" } : undefined}>{children}</section>
    </div>
  );
}
