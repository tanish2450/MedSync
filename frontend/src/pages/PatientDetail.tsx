import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, put } from "../api";
import { useAuth } from "../auth";
import { AdherencePanel, Badge, DoseChecklist, ErrorBox, fmtDate, fmtDateTime, useLoad } from "../components";
import { HistoryCard } from "./HistoryCard";
import { AllergyEditor } from "./AllergyEditor";
import { DiscontinueDialog, ModifyDialog, Prescribe } from "./Prescribe";
import { MessagePatientButton } from "./Chat";

export function PatientDetail() {
  const { id } = useParams(); const { me } = useAuth();
  const rec = useLoad(() => get(`/patients/${id}`), [id]);
  const hist = useLoad(() => get<any[]>(`/patients/${id}/medications?history=1`), [id]);
  const scans = useLoad(() => (me?.role === "doctor" ? get<any[]>("/scans") : Promise.resolve([] as any[])), [id, me?.role]);
  const [modify, setModify] = useState<any>(null); const [stop, setStop] = useState<any>(null);
  if (rec.error) return <ErrorBox e={rec.error} />;
  if (!rec.data) return <p>Loading…</p>;
  const { patient: p, medications, insurance } = rec.data;
  const isDoctor = me?.role === "doctor"; const isAdmin = me?.role === "admin_nurse";
  const refresh = () => { rec.reload(); hist.reload(); };
  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start" }}><h1 className="grow">{p.name}{p.emergency?.active && <> <span className="sos-tag">Emergency</span></>}</h1>
        {(isDoctor || isAdmin) && <MessagePatientButton patientId={p.id} />}</div>
      <p className="muted">{[p.gender, p.dob && `DOB ${p.dob}`, p.bloodGroup && `Blood group ${p.bloodGroup}`, p.phone].filter(Boolean).join(" · ")}</p>
      {!isDoctor && <div className="muted">Read-only clinical view{isAdmin ? ": Admin/Nurse accounts cannot change diagnoses or medicines." : "."}</div>}

      <div className="grid gap">
        {me?.role === "patient" || me?.role === "caregiver"
          ? <AllergyEditor patientId={p.id} allergies={p.allergies ?? []} onSaved={rec.reload} />
          : <div className="card"><h2>Allergies</h2>{p.allergies?.length ? p.allergies.map((a: any, i: number) => <div key={i}><b>{a.substance}</b>{a.reaction ? ` — ${a.reaction}` : ""}</div>) : <span className="muted">None recorded</span>}</div>}
        <div className="card"><h2>Conditions / issues</h2>{p.conditions?.length ? p.conditions.map((c: string) => <div key={c}>{c}</div>) : <span className="muted">None recorded</span>}</div>
        <InsuranceCard patientId={p.id} insurance={insurance} editable={isAdmin} onSaved={rec.reload} />
      </div>
      {isDoctor && scans.data?.filter((s) => s.patientId === p.id && s.status === "Pending review").map((s) => (
        <div className="card" key={s.id} style={{ borderColor: "var(--cta)" }}><h2>Uploaded prescription waiting for review</h2>
          <p>{s.items.length ? s.items.map((i: any) => i.drugName ?? i.rawName).join(", ") : "Photo only. Enter the medicines from the image."}</p><Link to={`/scans/${s.id}`}><button className="primary sm">Review and add</button></Link></div>))}
      {isDoctor && <ClinicalEditor patient={p} onSaved={rec.reload} />}
      {isAdmin && <AdminEdit patient={p} onSaved={rec.reload} />}

      <div className="card">
        <h2>Current medicines (all doctors)</h2>
        <table><thead><tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Course</th><th>Prescriber</th><th>Status</th>{isDoctor && <th />}</tr></thead><tbody>
          {medications.map((m: any) => (
            <tr key={m.itemId}><td><b>{m.drugName}</b><div className="muted">{m.strength} {m.form} · v{m.version}</div></td><td>{m.dose}</td><td>{m.frequency}{m.reminderTimes?.length ? <div className="muted">Reminders {m.reminderTimes.join(" · ")}</div> : <div className="muted">No reminders (as needed)</div>}</td>
              <td>{fmtDate(m.startDate)} → {fmtDate(m.endDate)}</td><td>{m.doctorName}</td><td><Badge v={m.status} /></td>
              {isDoctor && <td><div className="row"><button onClick={() => setModify(m)}>Modify</button><button className="danger" onClick={() => setStop(m)}>Discontinue</button></div></td>}</tr>
          ))}
          {!medications.length && <tr><td colSpan={7} className="muted">No active medicines</td></tr>}
        </tbody></table>
      </div>

      <div className="grid">
        <div className="card"><h2>Adherence (7 days)</h2><AdherencePanel patientId={p.id} /></div>
        <div className="card"><h2>Today&apos;s doses</h2><DoseChecklist patientId={p.id} canMark={me?.role === "patient" || me?.role === "caregiver"} /></div>
      </div>

      <HistoryCard patientId={p.id} canAdd={isDoctor || isAdmin} />

      {isDoctor && <Prescribe patientId={p.id} onDone={refresh} />}

      <div className="card"><h2>Prescription &amp; dosage history</h2>
        {hist.data?.length ? <div className="timeline">{hist.data.map((h) => (
          <div key={h.versionKey} className="ev"><b>{h.drugName}</b> {h.strength} — <i>{h.changeType}</i> (v{h.version}) <Badge v={h.status} />
            <div className="muted">{fmtDateTime(h.createdAt)} · {h.doctorName}{h.changeReason ? ` · Reason: ${h.changeReason}` : ""}</div>
            <div className="muted">{h.dose}, {h.frequency}, {h.durationDays} days</div></div>))}</div> : <span className="muted">No history yet</span>}
      </div>
      {modify && <ModifyDialog patientId={p.id} med={modify} onClose={() => setModify(null)} onDone={refresh} />}
      {stop && <DiscontinueDialog patientId={p.id} med={stop} onClose={() => setStop(null)} onDone={refresh} />}
    </div>
  );
}

function InsuranceCard({ patientId, insurance, editable, onSaved }: { patientId: string; insurance: any; editable: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [f, setF] = useState(insurance ?? { provider: "", policyNo: "", validFrom: "", validTo: "", status: "Pending", coverageType: "", notes: "" });
  const save = async () => { try { await put(`/patients/${patientId}/insurance`, f); setEdit(false); onSaved(); } catch (e) { setErr(e); } };
  return (
    <div className="card"><h2>Insurance</h2>
      {!edit ? (insurance ? <div><Badge v={insurance.status} /> <b>{insurance.provider}</b><div>Policy {insurance.policyNo}</div><div className="muted">Valid {fmtDate(insurance.validFrom)} → {fmtDate(insurance.validTo)}</div>
        {insurance.coverageType && <div className="muted">{insurance.coverageType}</div>}{insurance.notes && <div className="muted">{insurance.notes}</div>}
        <div className="muted">Updated by {insurance.updatedBy} · {fmtDateTime(insurance.updatedAt)}</div></div> : <span className="muted">No insurance on file</span>)
        : <div>
          {(["provider", "policyNo", "coverageType", "notes"] as const).map((k) => <div key={k}><label>{k}</label><input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
          <div className="row"><div className="field"><label>Valid from</label><input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></div>
            <div className="field"><label>Valid to</label><input type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></div></div>
          <label>Status</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{["Active", "Expired", "Pending", "Rejected"].map((s) => <option key={s}>{s}</option>)}</select>
          <ErrorBox e={err} /><div className="row gap"><button className="primary" onClick={save}>Save</button><button onClick={() => setEdit(false)}>Cancel</button></div></div>}
      {editable && !edit && <button className="gap" onClick={() => setEdit(true)}>{insurance ? "Update" : "Add insurance"}</button>}
    </div>
  );
}

function ClinicalEditor({ patient, onSaved }: { patient: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [al, setAl] = useState((patient.allergies ?? []).map((a: any) => (a.reaction ? `${a.substance} - ${a.reaction}` : a.substance)).join("\n"));
  const [cond, setCond] = useState((patient.conditions ?? []).join("\n"));
  const save = async () => {
    try {
      const allergies = al.split("\n").map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [s, ...r] = l.split(" - "); return { substance: s.trim(), reaction: r.join(" - ").trim() || undefined }; });
      const conditions = cond.split("\n").map((l: string) => l.trim()).filter(Boolean);
      await put(`/patients/${patient.id}/clinical`, { allergies, conditions }); setOpen(false); onSaved();
    } catch (e) { setErr(e); }
  };
  return !open ? <button onClick={() => setOpen(true)}>Edit allergies &amp; conditions</button> : (
    <div className="card"><h2>Edit allergies &amp; conditions</h2>
      <label>Allergies (one per line: substance or class - reaction)</label><textarea rows={4} value={al} onChange={(e) => setAl(e.target.value)} />
      <label className="gap">Conditions (one per line)</label><textarea rows={3} value={cond} onChange={(e) => setCond(e.target.value)} />
      <ErrorBox e={err} /><div className="row gap"><button className="primary" onClick={save}>Save</button><button onClick={() => setOpen(false)}>Cancel</button></div></div>
  );
}

function AdminEdit({ patient, onSaved }: { patient: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [err, setErr] = useState<unknown>(null);
  const docs = useLoad(() => get<any[]>("/doctors"));
  const [f, setF] = useState({ name: patient.name, phone: patient.phone ?? "", dob: patient.dob ?? "", gender: patient.gender ?? "", address: patient.address ?? "", bloodGroup: patient.bloodGroup ?? "",
    ecName: patient.emergencyContact?.name ?? "", ecPhone: patient.emergencyContact?.phone ?? "", assignedDoctors: patient.assignedDoctors ?? [] as string[] });
  const save = async () => {
    try {
      const { ecName, ecPhone, ...rest } = f;
      await put(`/patients/${patient.id}`, { ...rest, emergencyContact: { name: ecName, phone: ecPhone } }); setOpen(false); onSaved();
    } catch (e) { setErr(e); }
  };
  if (!open) return <button onClick={() => setOpen(true)}>Edit patient details</button>;
  const toggle = (id: string) => setF({ ...f, assignedDoctors: f.assignedDoctors.includes(id) ? f.assignedDoctors.filter((x: string) => x !== id) : [...f.assignedDoctors, id] });
  return (
    <div className="card"><h2>Edit patient details</h2>
      <div className="row">{(["name", "phone", "dob", "gender", "bloodGroup", "ecName", "ecPhone"] as const).map((k) => <div className="field" key={k}><label>{k}</label><input value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}</div>
      <label className="gap">Address</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <label className="gap">Assigned doctors</label>
      {docs.data?.map((d) => <label key={d.id} style={{ display: "flex", gap: 8 }}><input type="checkbox" style={{ width: "auto" }} checked={f.assignedDoctors.includes(d.id)} onChange={() => toggle(d.id)} />{d.name} — {d.specialty}</label>)}
      <ErrorBox e={err} /><div className="row gap"><button className="primary" onClick={save}>Save</button><button onClick={() => setOpen(false)}>Cancel</button></div></div>
  );
}
