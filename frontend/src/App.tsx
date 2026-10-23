import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth, type Role } from "./auth";
import { FinishProfile } from "./pages/SignUp";
import Profile from "./pages/Profile";
import { OrdersPage } from "./pages/Orders";
import { PharmacyOrders } from "./pages/PharmacyOrders";
import { PrescriptionUpload } from "./pages/ScanUpload";
import { DoctorScans, ScanReview } from "./pages/ScanReview";
import { NotificationBell } from "./components";
import { Icon, Logo, navIcon, useRoleSkin, useTheme } from "./brand";
import Login from "./pages/Login";
import { AdminHome, AdminPatients, AdminDoctors, AdminPharmacies, AdminConfirmations } from "./pages/admin";
import { DoctorPatients, DoctorAvailability } from "./pages/doctor";
import { PatientHome, FindDoctors, DoctorProfile, Health, Caregivers, CaregiverHome } from "./pages/patient";
import { PatientDetail } from "./pages/PatientDetail";
import { AppointmentsPage } from "./pages/Appointments";
import { MessagesPage } from "./pages/Chat";

const NAV: Record<Role, [string, string][]> = {
  admin_nurse: [["/", "Overview"], ["/patients", "Patients"], ["/doctors", "Doctors"], ["/appointments", "Appointments"], ["/messages", "Messages"], ["/confirmations", "Confirmations"], ["/pharmacies", "Pharmacies"]],
  doctor: [["/patients", "My patients"], ["/messages", "Messages"], ["/scans", "Prescription uploads"], ["/appointments", "Appointments"], ["/availability", "Availability"]],
  patient: [["/", "Home"], ["/messages", "Messages"], ["/find", "Find a doctor"], ["/health", "My health"], ["/appointments", "Appointments"], ["/caregivers", "Caregivers"], ["/prescriptions", "Upload prescription"], ["/orders", "Order medicines"]],
  caregiver: [["/", "Linked patients"], ["/orders", "Order medicines"]],
  pharmacy: [["/", "Orders"]],
};
const TOP: Role[] = ["patient", "caregiver"];

function useLargeText() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem("largeText") === "1"; } catch { return false; } });
  useEffect(() => { document.body.classList.toggle("large-text", on); try { localStorage.setItem("largeText", on ? "1" : "0"); } catch { /* storage unavailable */ } }, [on]);
  return [on, setOn] as const;
}

export default function App() {
  const { me, ready, logout } = useAuth();
  const [large, setLarge] = useLargeText();
  const [theme, toggleTheme] = useTheme();
  const { pathname } = useLocation();
  useRoleSkin(me?.role);
  if (!ready) return <div className="page"><div className="skeleton" /></div>;
  if (!me) return <Login />;
  if (!me.role) return <FinishProfile />;
  const role: Role = me.role;
  const home = role === "doctor" ? "/patients" : "/";
  const links = NAV[role];

  // keyed wrapper replays the enter animation on every navigation
  const routes = (
    <div className="route" key={pathname}><Routes>
      {role === "admin_nurse" && <>
        <Route path="/" element={<AdminHome />} /><Route path="/patients" element={<AdminPatients />} /><Route path="/doctors" element={<AdminDoctors />} />
        <Route path="/pharmacies" element={<AdminPharmacies />} /><Route path="/confirmations" element={<AdminConfirmations />} />
      </>}
      {role === "doctor" && <><Route path="/patients" element={<DoctorPatients />} /><Route path="/availability" element={<DoctorAvailability />} /></>}
      {role === "patient" && <><Route path="/" element={<PatientHome />} /><Route path="/find" element={<FindDoctors />} /><Route path="/doctor/:id" element={<DoctorProfile />} /><Route path="/health" element={<Health />} /><Route path="/caregivers" element={<Caregivers />} /></>}
      {role === "caregiver" && <Route path="/" element={<CaregiverHome />} />}
      {role === "pharmacy" && <Route path="/" element={<PharmacyOrders />} />}
      {["admin_nurse", "doctor", "patient"].includes(role) && <Route path="/appointments" element={<AppointmentsPage />} />}
      {["admin_nurse", "doctor", "patient"].includes(role) && <Route path="/messages" element={<MessagesPage />} />}
      {role !== "pharmacy" && <Route path="/patient/:id" element={<PatientDetail />} />}
      <Route path="/profile" element={<Profile />} />
      {(role === "patient" || role === "caregiver") && <Route path="/orders" element={<OrdersPage />} />}
      {role === "patient" && <Route path="/prescriptions" element={<PrescriptionUpload />} />}
      {role === "doctor" && <><Route path="/scans" element={<DoctorScans />} /><Route path="/scans/:id" element={<ScanReview />} /></>}
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes></div>
  );
  const initials = (me.name || me.email || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const first = (me.name || "").split(" ")[0];
  const tools = (
    <div className="tools">
      <button className="iconbtn hide-sm" onClick={() => setLarge(!large)} aria-pressed={large} title="Larger text" aria-label="Larger text"><Icon n="text" /></button>
      <button className="iconbtn" onClick={toggleTheme} title={theme === "dark" ? "Light theme" : "Dark theme"} aria-label="Toggle theme"><Icon n={theme === "dark" ? "sun" : "moon"} /></button>
      <NotificationBell />
    </div>
  );
  const link = (to: string, label: string, cls: (a: boolean) => string) => (
    <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cls(isActive)}><Icon n={navIcon(to, role)} />{label}</NavLink>
  );

  if (TOP.includes(role)) return (
    <>
      <div className="topband" aria-hidden="true" />
      <header className="topbar"><div className="in">
        <Logo />
        <nav className="tabs" aria-label="Main">{links.map(([to, label]) => link(to, label, (a) => (a ? "active" : "")))}</nav>
        {tools}
        <NavLink to="/profile" className="avatarbtn" title="Your profile"><span className="avatar">{initials}</span><span className="hide-sm">{first}</span></NavLink>
        <button className="iconbtn hide-sm" onClick={logout} title="Sign out" aria-label="Sign out"><Icon n="out" /></button>
      </div></header>
      <main className="page">{routes}</main>
      <nav className="tabbar" aria-label="Mobile">{links.slice(0, 4).map(([to, label]) => link(to, label.split(" ")[0], (a) => (a ? "active" : "")))}<NavLink to="/profile" className={({ isActive }) => (isActive ? "active" : "")}><Icon n="user" />Profile</NavLink></nav>
    </>
  );
  return (
    <div className="shell">
      <div className="topband" aria-hidden="true" />
      <nav className="side" aria-label="Main">
        <Logo />
        {links.map(([to, label]) => link(to, label, (a) => `nav${a ? " active" : ""}`))}
        <div className="who">
          <NavLink to="/profile" className="id" style={{ textDecoration: "none" }}><span className="avatar sm">{initials}</span><div><b>{me.name}</b>{role === "admin_nurse" ? "admin / nurse" : role}</div></NavLink>
          {tools}
          <button className="sm" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="main">{routes}</main>
    </div>
  );
}
