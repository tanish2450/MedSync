import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth, type Role } from "./auth";
import { FinishProfile } from "./pages/SignUp";
import Profile from "./pages/Profile";
import { OrdersPage } from "./pages/Orders";
import { PharmacyOrders } from "./pages/PharmacyOrders";
import { PrescriptionUpload } from "./pages/ScanUpload";
import { DoctorScans, ScanReview } from "./pages/ScanReview";
import { NotificationBell } from "./components";
import Login from "./pages/Login";
import { AdminHome, AdminPatients, AdminDoctors, AdminPharmacies, AdminConfirmations } from "./pages/admin";
import { DoctorPatients, DoctorAvailability } from "./pages/doctor";
import { PatientHome, FindDoctors, DoctorProfile, Health, Caregivers, CaregiverHome } from "./pages/patient";
import { PatientDetail } from "./pages/PatientDetail";
import { AppointmentsPage } from "./pages/Appointments";

const NAV: Record<Role, [string, string][]> = {
  admin_nurse: [["/", "Overview"], ["/patients", "Patients"], ["/doctors", "Doctors"], ["/appointments", "Appointments"], ["/confirmations", "Confirmations"], ["/pharmacies", "Pharmacies"]],
  doctor: [["/patients", "My patients"], ["/scans", "Prescription uploads"], ["/appointments", "Appointments"], ["/availability", "Availability"]],
  patient: [["/", "Home"], ["/find", "Find a doctor"], ["/health", "My health"], ["/appointments", "Appointments"], ["/caregivers", "Caregivers"], ["/prescriptions", "Upload prescription"], ["/orders", "Order medicines"]],
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
  if (!ready) return <div className="page"><div className="skeleton" /></div>;
  if (!me) return <Login />;
  if (!me.role) return <FinishProfile />;
  const role: Role = me.role;
  const home = role === "doctor" ? "/patients" : "/";
  const links = NAV[role];

  const routes = (
    <Routes>
      {role === "admin_nurse" && <>
        <Route path="/" element={<AdminHome />} /><Route path="/patients" element={<AdminPatients />} /><Route path="/doctors" element={<AdminDoctors />} />
        <Route path="/pharmacies" element={<AdminPharmacies />} /><Route path="/confirmations" element={<AdminConfirmations />} />
      </>}
      {role === "doctor" && <><Route path="/patients" element={<DoctorPatients />} /><Route path="/availability" element={<DoctorAvailability />} /></>}
      {role === "patient" && <><Route path="/" element={<PatientHome />} /><Route path="/find" element={<FindDoctors />} /><Route path="/doctor/:id" element={<DoctorProfile />} /><Route path="/health" element={<Health />} /><Route path="/caregivers" element={<Caregivers />} /></>}
      {role === "caregiver" && <Route path="/" element={<CaregiverHome />} />}
      {role === "pharmacy" && <Route path="/" element={<PharmacyOrders />} />}
      {["admin_nurse", "doctor", "patient"].includes(role) && <Route path="/appointments" element={<AppointmentsPage />} />}
      {role !== "pharmacy" && <Route path="/patient/:id" element={<PatientDetail />} />}
      <Route path="/profile" element={<Profile />} />
      {(role === "patient" || role === "caregiver") && <Route path="/orders" element={<OrdersPage />} />}
      {role === "patient" && <Route path="/prescriptions" element={<PrescriptionUpload />} />}
      {role === "doctor" && <><Route path="/scans" element={<DoctorScans />} /><Route path="/scans/:id" element={<ScanReview />} /></>}
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
  const tools = (
    <div className="row" style={{ gap: 8 }}>
      <button className="sm" onClick={() => setLarge(!large)} aria-pressed={large} title="Larger text">A{large ? "−" : "+"}</button>
      <NavLink to="/profile" className="sm" style={{ padding: "6px 12px", border: "1px solid var(--border,#cbd5e1)", borderRadius: 8, textDecoration: "none", color: "inherit" }}>Profile</NavLink>
      <NotificationBell />
    </div>
  );

  if (TOP.includes(role)) return (
    <>
      <header className="topbar"><div className="in">
        <div className="logo"><i /><span>MedSync</span></div>
        <nav className="tabs" aria-label="Main">{links.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>)}</nav>
        {tools}<button className="sm" onClick={logout}>Sign out</button>
      </div></header>
      <main className="page">{routes}</main>
      <nav className="tabbar" aria-label="Mobile">{links.slice(0, 5).map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>)}</nav>
    </>
  );
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="logo" style={{ marginBottom: 14 }}><i /><span>MedSync</span></div>
        {links.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav${isActive ? " active" : ""}`}>{label}</NavLink>)}
        <div className="who"><b>{me.name}</b><br />{role.replace("_", "/")}<div className="row gap" style={{ gap: 8 }}>{tools}</div><button className="sm gap" onClick={logout}>Sign out</button></div>
      </nav>
      <main className="main">{routes}</main>
    </div>
  );
}
