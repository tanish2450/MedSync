import { useState } from "react";
import { Link } from "react-router-dom";
import { get, post, put } from "../api";
import { Badge, Empty, ErrorBox, Modal, fmtDateTime, useLoad } from "../components";

export function AdminHome() {
  const pts = useLoad(() => get<any[]>("/patients")); const docs = useLoad(() => get<any[]>("/doctors")); const appts = useLoad(() => get<any[]>("/appointments"));
  const conf = useLoad(() => get<any[]>("/confirmations"), [], 30000); const low = useLoad(() => get<any[]>("/adherence/low"), [], 60000);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const todays = (appts.data ?? []).filter((a) => a.slotStart.startsWith(today) && a.status === "Booked");
  return (
    <div><h1>Operations overview</h1>
      <div className="kpis">
        <div className="kpi k-coral"><span className="lbl">Patients</span><span className="n">{pts.data?.length ?? "…"}</span></div>
        <div className="kpi k-mint sq"><span className="lbl">Doctors</span><span className="n">{docs.data?.length ?? "…"}</span></div>
        <div className="kpi k-sun tri"><span className="lbl">Appointments today</span><span className="n">{appts.data ? todays.length : "…"}</span></div>
        <div className="kpi k-lilac"><span className="lbl">Pending confirmations</span><span className="n">{conf.data ? conf.data.filter((t) => t.status === "Pending" || t.status === "Sent").length : "…"}</span></div>
      </div>
      <div className="card gap"><h2>Patients with low adherence (read-only)</h2>
        {low.data?.length ? <table><tbody>{low.data.map((r) => <tr key={r.patientId}><td><Link to={`/patient/${r.patientId}`}>{r.name}</Link></td><td><Badge v="Missed" /> {r.percent}% over 7 days</td><td className="muted">{r.missed} missed doses</td></tr>)}</tbody></table> : <Empty>No patients below 70% this week.</Empty>}</div>
      <div className="card"><h2>Today</h2>{todays.length ? <table><tbody>{todays.map((a) => <tr key={a.id}><td>{fmtDateTime(a.slotStart)}</td><td><Link to={`/patient/${a.patientId}`}>{a.patientName}</Link></td><td>{a.doctorName}</td></tr>)}</tbody></table> : <span className="muted">No appointments today</span>}</div>
    </div>
  );
}

export function AdminPatients() {
  const [q, setQ] = useState(""); const { data, error, reload } = useLoad(() => get<any[]>(`/patients?q=${encodeURIComponent(q)}`), [q]);
  const [open, setOpen] = useState(false);
  return (
    <div><div className="row"><h1 className="grow">Patients</h1><button className="primary" onClick={() => setOpen(true)}>Register patient</button></div>
      <input placeholder="Search by name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} /><ErrorBox e={error} />
      <div className="card gap"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Doctors</th></tr></thead><tbody>
        {data?.map((p) => <tr key={p.id}><td><Link to={`/patient/${p.id}`}>{p.name}</Link></td><td>{p.phone ?? "—"}</td><td>{p.email}</td><td>{p.assignedDoctors?.length ?? 0}</td></tr>)}</tbody></table></div>
      {open && <RegisterPatient onClose={() => setOpen(false)} onDone={reload} />}
    </div>
  );
}

function RegisterPatient({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ name: "", email: "", phone: "", dob: "", gender: "", address: "" }); const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title="Register patient" onClose={onClose}>
      <p className="muted">A Cognito account is created and a temporary password is emailed to the patient.</p>
      {(["name", "email", "phone", "dob", "gender", "address"] as const).map((k) => <div key={k}><label>{k}</label><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
      <ErrorBox e={err} /><button className="primary gap" onClick={async () => { try { await post("/patients", f); onDone(); onClose(); } catch (e) { setErr(e); } }}>Register</button>
    </Modal>
  );
}

export function AdminDoctors() {
  const { data, error, reload } = useLoad(() => get<any[]>("/doctors")); const [open, setOpen] = useState(false);
  return (
    <div><div className="row"><h1 className="grow">Doctors</h1><button className="primary" onClick={() => setOpen(true)}>Onboard doctor</button></div><ErrorBox e={error} />
      <div className="card"><table><thead><tr><th>Name</th><th>Specialty</th><th>Reg. no.</th><th>Clinic</th><th>Fee</th><th>Status</th><th /></tr></thead><tbody>
        {data?.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.specialty}</td><td>{d.registrationNo}</td><td>{d.clinic?.name}</td><td>₹{d.fee}</td><td><Badge v={d.active ? "Active" : "Expired"} /></td>
          <td><button onClick={async () => { await put(`/doctors/${d.id}`, { active: !d.active }); reload(); }}>{d.active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div>
      {open && <OnboardDoctor onClose={() => setOpen(false)} onDone={reload} />}
    </div>
  );
}

function OnboardDoctor({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ name: "", email: "", specialty: "", registrationNo: "", fee: 500, clinicName: "", clinicAddress: "", lat: "", lng: "", languages: "English" }); const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    try {
      await post("/doctors", { name: f.name, email: f.email, specialty: f.specialty, registrationNo: f.registrationNo, fee: Number(f.fee), languages: f.languages.split(",").map((s: string) => s.trim()),
        clinic: { name: f.clinicName, address: f.clinicAddress, lat: Number(f.lat), lng: Number(f.lng) },
        availability: { slotMinutes: 30, weeklyHours: {}, breaks: [], leaveDates: [] } });
      onDone(); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Onboard doctor" onClose={onClose}>
      {Object.keys(f).map((k) => <div key={k}><label>{k}</label><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
      <p className="muted">The doctor sets their own working hours under Availability after first sign-in.</p>
      <ErrorBox e={err} /><button className="primary gap" onClick={save}>Create doctor</button>
    </Modal>
  );
}

export function AdminPharmacies() {
  const { data, error, reload } = useLoad(() => get<any[]>("/pharmacies")); const [f, setF] = useState<any>({ name: "", address: "", lat: "", lng: "", hours: "", phone: "", staffEmail: "" }); const [err, setErr] = useState<unknown>(null);
  return (
    <div><h1>Pharmacies</h1><ErrorBox e={error} />
      <div className="card"><table><thead><tr><th>Name</th><th>Address</th><th>Hours</th><th>Phone</th></tr></thead><tbody>{data?.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.address}</td><td>{p.hours}</td><td>{p.phone}</td></tr>)}</tbody></table></div>
      <div className="card"><h2>Add pharmacy</h2><div className="row">{Object.keys(f).map((k) => <div className="field" key={k}><label>{k}</label><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}</div>
        <ErrorBox e={err} /><button className="primary gap" onClick={async () => { try { await post("/pharmacies", { ...f, lat: Number(f.lat), lng: Number(f.lng), staffEmail: f.staffEmail || undefined }); reload(); } catch (e) { setErr(e); } }}>Add</button></div>
    </div>
  );
}

export function AdminConfirmations() {
  const { data, error, loading } = useLoad(() => get<any[]>("/confirmations"), [], 15000);
  return (
    <div><h1>Day-before confirmations</h1>
      <p className="muted">At 18:00 IST every day the system messages each doctor to confirm tomorrow&apos;s appointments. Unanswered tasks are flagged here for a phone call or reassignment.</p><ErrorBox e={error} />
      <div className="card"><table><thead><tr><th>Appointment</th><th>Doctor</th><th>Patient</th><th>Status</th><th>Sent</th><th>Delivery</th><th /></tr></thead><tbody>
        {data?.map((t) => <tr key={t.appointmentId}><td>{fmtDateTime(t.slotStart)}</td><td>{t.doctorName}</td><td>{t.patientName}</td><td><Badge v={t.status} /></td><td>{t.sentAt ? fmtDateTime(t.sentAt) : "—"}</td>
          <td className="muted">{Object.entries(t.deliveryStatus ?? {}).map(([c, s]) => `${c}: ${s}`).join(", ") || "—"}</td><td>{t.needsCall && <Badge v="Cancelled" />}{t.needsCall && " Needs a call"}</td></tr>)}
        {!loading && !data?.length && <tr><td colSpan={7} className="muted">No confirmation tasks yet. They are created automatically the evening before an appointment.</td></tr>}</tbody></table></div>
    </div>
  );
}
