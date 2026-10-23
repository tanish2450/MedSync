import { AllergyEditor } from "./AllergyEditor";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { del, get, post } from "../api";
import { useAuth } from "../auth";
import { AdherencePanel, Avatar, Badge, DoctorCard, DoseChecklist, Empty, ErrorBox, Skeleton, downloadIcs, fmtDate, fmtDateTime, fmtDay, fmtTime, useLoad, type DocT } from "../components";
import { SlotPicker } from "./Appointments";

export function PatientHome() {
  const { me } = useAuth(); const nav = useNavigate();
  const [q, setQ] = useState(""); const [day, setDay] = useState("any");
  const docs = useLoad(() => get<DocT[]>("/doctors?slots=1"));
  const appts = useLoad(() => get<any[]>("/appointments"));
  const specs = useMemo(() => [...new Set((docs.data ?? []).map((d) => d.specialty))], [docs.data]);
  const next = (appts.data ?? []).find((a) => a.status === "Booked" && a.slotStart >= new Date().toISOString());
  const go = (spec?: string) => nav(`/find?q=${encodeURIComponent(q)}&day=${day}${spec ? `&specialty=${encodeURIComponent(spec)}` : ""}`);
  return (
    <div>
      <section className="hero">
        <h1>Find the right doctor. Book in seconds. Stay on track with your medicines.</h1>
        <p>See real open times from verified doctors, and keep every prescription from every doctor in one place.</p>
        <form className="searchbar" onSubmit={(e) => { e.preventDefault(); go(); }} role="search">
          <div><label htmlFor="hq">Doctor or specialty</label><input id="hq" placeholder="e.g. Cardiology, Dr. Rao" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div style={{ maxWidth: 190 }}><label htmlFor="hd">When</label><select id="hd" value={day} onChange={(e) => setDay(e.target.value)}><option value="any">Any day</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">This week</option></select></div>
          <button className="primary" type="submit">Find care</button>
        </form>
        <div className="chips">{specs.map((s) => <a key={s} className="chip" href="#" onClick={(e) => { e.preventDefault(); go(s); }}>{s}</a>)}</div>
        <div className="trust"><span>✔ Registered doctors</span><span>🔒 Private &amp; encrypted</span><span>📅 Real-time availability</span></div>
      </section>

      <div className="split">
        <div>
          <div className="card"><h2>Today&apos;s medicines</h2><DoseChecklist patientId={me!.sub} canMark /></div>
          <h2>Next available</h2>
          {docs.loading ? <Skeleton lines={4} /> : (docs.data ?? []).filter((d) => d.nextSlots?.length).slice(0, 3).map((d) => <DoctorCard key={d.id} d={d} onSlot={(s) => nav(`/doctor/${d.id}?slot=${encodeURIComponent(s)}`)} onOpen={() => nav(`/doctor/${d.id}`)} />)}
        </div>
        <aside>
          <div className="card"><h2>Your adherence</h2><AdherencePanel patientId={me!.sub} /></div>
          <div className="card"><h2>Next appointment</h2>
            {appts.loading ? <Skeleton lines={2} /> : next ? <div><b>{next.doctorName}</b><div>{fmtDateTime(next.slotStart)}</div><div className="muted">{next.reason ?? "No reason given"}</div>
              <div className="row gap"><button className="sm" onClick={() => downloadIcs({ title: `Appointment with ${next.doctorName}`, start: next.slotStart, end: next.slotEnd })}>Add to calendar</button><Link to="/appointments">Manage</Link></div></div> : <Empty>No upcoming appointment. <Link to="/find">Find a doctor</Link></Empty>}
          </div>
        </aside>
      </div>
    </div>
  );
}

const inDay = (iso: string, day: string) => {
  const d = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
  const s = iso.slice(0, 10);
  return day === "today" ? s === d(0) : day === "tomorrow" ? s === d(1) : day === "week" ? s >= d(0) && s <= d(6) : true;
};

export function FindDoctors() {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? ""; const spec = sp.get("specialty") ?? ""; const day = sp.get("day") ?? "any";
  const [lang, setLang] = useState(""); const [maxFee, setMaxFee] = useState("");
  const { data, error, loading } = useLoad(() => get<DocT[]>(`/doctors?slots=1&q=${encodeURIComponent(q)}${spec ? `&specialty=${encodeURIComponent(spec)}` : ""}${maxFee ? `&maxFee=${maxFee}` : ""}${lang ? `&language=${encodeURIComponent(lang)}` : ""}`), [q, spec, maxFee, lang]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  const list = (data ?? []).map((d) => ({ ...d, nextSlots: d.nextSlots?.filter((s) => inDay(s.start, day)) })).filter((d) => day === "any" || d.nextSlots?.length)
    .sort((a, b) => (a.nextSlots?.[0]?.start ?? "9").localeCompare(b.nextSlots?.[0]?.start ?? "9"));
  return (
    <div>
      <h1>Find a doctor</h1><p className="muted">Sorted by earliest available time. Times shown in IST.</p>
      <div className="filters">
        <div className="field"><input aria-label="Search" placeholder="Name, specialty or clinic" value={q} onChange={(e) => set("q", e.target.value)} /></div>
        <select aria-label="When" style={{ maxWidth: 160 }} value={day} onChange={(e) => set("day", e.target.value)}><option value="any">Any day</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">This week</option></select>
        <select aria-label="Language" style={{ maxWidth: 150 }} value={lang} onChange={(e) => setLang(e.target.value)}><option value="">Any language</option>{["English", "Hindi", "Kannada"].map((l) => <option key={l}>{l}</option>)}</select>
        <select aria-label="Maximum fee" style={{ maxWidth: 150 }} value={maxFee} onChange={(e) => setMaxFee(e.target.value)}><option value="">Any fee</option><option value="500">Up to ₹500</option><option value="700">Up to ₹700</option></select>
        {spec && <button className="sm" onClick={() => set("specialty", "")}>{spec} ✕</button>}
      </div>
      <ErrorBox e={error} />
      {loading ? <Skeleton lines={6} /> : list.length ? list.map((d) => <DoctorCard key={d.id} d={d} onSlot={(s) => nav(`/doctor/${d.id}?slot=${encodeURIComponent(s)}`)} onOpen={() => nav(`/doctor/${d.id}`)} />) : <Empty>No doctors match these filters.</Empty>}
    </div>
  );
}

export function DoctorProfile() {
  const { id } = useParams(); const [sp] = useSearchParams(); const nav = useNavigate();
  const doc = useLoad(() => get<DocT & { registrationNo: string; availability: any }>(`/doctors/${id}`), [id]);
  const [slot, setSlot] = useState(sp.get("slot") ?? ""); const [reason, setReason] = useState("");
  const [step, setStep] = useState(sp.get("slot") ? 2 : 1); const [done, setDone] = useState<any>(null); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  if (doc.error) return <ErrorBox e={doc.error} />; if (!doc.data) return <Skeleton lines={6} />;
  const d = doc.data;
  const book = async () => { setBusy(true); setErr(null); try { setDone(await post("/appointments", { doctorId: d.id, slotStart: slot, reason })); setStep(3); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <div className="split">
      <div>
        <div className="card"><div className="row" style={{ gap: 16 }}><Avatar name={d.name} /><div><h1>{d.name}</h1><div><b>{d.specialty}</b> · {d.qualifications}</div><span className={`pill ${d.onlineStatus}`}>{d.onlineStatus === "Available" ? "Available now" : d.onlineStatus}</span></div></div></div>
        <div className="grid">
          <div className="card"><h2>Clinic</h2><b>{d.clinic.name}</b><div>{d.clinic.address}</div><div className="muted">{d.consultationHours}</div></div>
          <div className="card"><h2>Details</h2><div>Consultation fee ₹{d.fee}</div><div>Languages: {d.languages?.join(", ")}</div><div className="muted">Registration no. {d.registrationNo}</div></div>
        </div>
      </div>
      <aside className="sticky card">
        <div className="steps" aria-label="Booking progress">{["Pick a time", "Your details", "Confirmed"].map((s, i) => <div key={s} className={`st ${step === i + 1 ? "on" : step > i + 1 ? "done" : ""}`}>{i + 1}. {s}</div>)}</div>
        {step === 1 && <><SlotPicker doctorId={d.id} onPick={(s) => setSlot(s)} /><button className="primary gap" disabled={!slot} onClick={() => setStep(2)}>Continue</button></>}
        {step === 2 && <>
          <div className="success">Selected: <b>{fmtDay(slot)}, {fmtTime(slot)}</b> <a href="#" onClick={(e) => { e.preventDefault(); setStep(1); }}>change</a></div>
          <label>Reason for visit</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Follow-up, new symptoms" />
          <p className="muted">Your doctor will see your medicines and allergies. Fee: ₹{d.fee}, paid at the clinic.</p>
          <ErrorBox e={err} /><button className="primary" disabled={busy} onClick={book}>{busy ? "Booking…" : "Confirm booking"}</button></>}
        {step === 3 && done && <div>
          <div className="success"><b>You&apos;re booked!</b></div>
          <p>{d.name}<br />{fmtDateTime(done.slotStart)}<br />{d.clinic.name}</p>
          <p className="muted">The day before, we ask your doctor to confirm. You&apos;ll be notified if they need to reschedule.</p>
          <div className="row"><button onClick={() => downloadIcs({ title: `Appointment with ${d.name}`, start: done.slotStart, end: done.slotEnd, location: `${d.clinic.name}, ${d.clinic.address}` })}>Add to calendar (.ics)</button><button className="brand" onClick={() => nav("/appointments")}>View appointments</button></div></div>}
      </aside>
    </div>
  );
}

export function Health() {
  const { me } = useAuth(); const { data, error, reload } = useLoad(() => get<any>(`/patients/${me!.sub}`));
  const [days, setDays] = useState(7);
  if (error) return <ErrorBox e={error} />; if (!data) return <Skeleton lines={6} />;
  const { patient: p, medications, insurance } = data;
  return (
    <div><h1>My health</h1>
      <div className="card"><b>Got a prescription from a doctor?</b> Upload a photo and the doctor adds it to your plan. <Link to="/prescriptions"><button className="sm primary">Upload prescription</button></Link></div>
      <div className="grid">
        <AllergyEditor patientId={p.id} allergies={p.allergies ?? []} onSaved={reload} />
        <div className="card"><h2>Insurance</h2>{insurance ? <div><Badge v={insurance.status} /> <b>{insurance.provider}</b><div>Policy {insurance.policyNo}</div><div className="muted">Valid until {fmtDate(insurance.validTo)} · updated by {insurance.updatedBy}</div></div> : <span className="muted">Not on file. Ask the front desk.</span>}</div>
        <div className="card"><div className="row"><h2 className="grow">Adherence</h2><select style={{ width: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option></select></div><AdherencePanel patientId={p.id} days={days} /></div>
      </div>
      <div className="card gap"><h2>My medicines</h2>
        <table><thead><tr><th>Medicine</th><th>How to take</th><th>Until</th><th>Prescribed by</th></tr></thead><tbody>
          {medications.map((m: any) => <tr key={m.itemId}><td><b>{m.drugName}</b><div className="muted">{m.strength} {m.form}</div></td><td>{m.dose}, {m.frequency}{m.reminderTimes?.length ? ` (reminders at ${m.reminderTimes.join(", ")})` : ""}{m.instructions ? ` — ${m.instructions}` : ""}</td><td>{fmtDate(m.endDate)}</td><td>{m.doctorName}</td></tr>)}
          {!medications.length && <tr><td colSpan={4} className="muted">No active medicines</td></tr>}</tbody></table>
        <p><Link to="/orders"><button className="primary sm">Order these medicines from a pharmacy</button></Link></p>
        <p className="muted"><Link to={`/patient/${p.id}`}>Full history of every change, across all your doctors →</Link></p></div>
    </div>
  );
}

export function Caregivers() {
  const { data, error, reload } = useLoad(() => get<any[]>("/caregivers")); const [f, setF] = useState({ name: "", email: "" }); const [err, setErr] = useState<unknown>(null);
  return (
    <div><h1>Caregivers</h1><p className="muted">Caregivers you invite can view your medicines and mark doses on your behalf. You can revoke access at any time.</p><ErrorBox e={error} />
      <div className="card"><table><thead><tr><th>Name</th><th>Email</th><th>Status</th><th /></tr></thead><tbody>
        {data?.map((c) => <tr key={c.caregiverId}><td>{c.caregiverName}</td><td>{c.caregiverEmail}</td><td><Badge v={c.status === "Revoked" ? "Cancelled" : c.status} /></td>
          <td>{c.status !== "Revoked" && <button className="danger sm" onClick={async () => { await del(`/caregivers/${c.caregiverId}`); reload(); }}>Revoke</button>}</td></tr>)}</tbody></table></div>
      <div className="card"><h2>Invite a caregiver</h2><div className="row"><div className="field"><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div></div>
        <ErrorBox e={err} /><button className="primary gap" onClick={async () => { try { await post("/caregivers/invite", f); setF({ name: "", email: "" }); reload(); } catch (e) { setErr(e); } }}>Send invite</button></div>
    </div>
  );
}

export function CaregiverHome() {
  const links = useLoad(() => get<any[]>("/caregivers")); const pts = useLoad(() => get<any[]>("/patients")); const [sel, setSel] = useState("");
  const active = sel || pts.data?.[0]?.id || "";
  return (
    <div><h1>Linked patients</h1><ErrorBox e={links.error ?? pts.error} />
      {links.data?.filter((l) => l.status === "Pending").map((l) => (
        <div className="card" key={l.patientId}><b>Invitation</b> to support a patient. <button className="primary sm" onClick={async () => { await post("/caregivers/accept", { patientId: l.patientId }); links.reload(); pts.reload(); }}>Accept</button></div>))}
      {pts.data && !pts.data.length && <Empty>No active links yet.</Empty>}
      {!!pts.data?.length && <>
        <div className="field" style={{ maxWidth: 320 }}><label>Patient</label><select value={active} onChange={(e) => setSel(e.target.value)}>{pts.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="grid gap"><div className="card"><h2>Today</h2><DoseChecklist patientId={active} canMark /></div><div className="card"><h2>Adherence</h2><AdherencePanel patientId={active} /></div></div>
        <p><Link to={`/patient/${active}`}>Medicines, allergies and full history →</Link></p></>}
    </div>
  );
}
