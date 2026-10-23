import { useState } from "react";
import { get, post } from "../api";
import { Badge, ErrorBox, fmtDate, fmtDateTime, useLoad } from "../components";

/** Longitudinal record for doctors/nurses: past illnesses, procedures, results, notes and this doctor's visits. Entries are append-only. */
export function HistoryCard({ patientId, canAdd }: { patientId: string; canAdd: boolean }) {
  const { data, error, reload } = useLoad(() => get<any>(`/patients/${patientId}/history`), [patientId]);
  const [open, setOpen] = useState(false); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: "", date: today, title: "", notes: "" });
  const [filter, setFilter] = useState("All");
  if (error) return <ErrorBox e={error} />;
  if (!data) return <div className="card"><p>Loading history…</p></div>;
  const types: string[] = data.types;
  const shown = (data.entries as any[]).filter((e) => filter === "All" || e.type === filter);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await post(`/patients/${patientId}/history`, f); setOpen(false); setF({ type: "", date: today, title: "", notes: "" }); reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Medical history</h2>
        {canAdd && !open && <button className="sm primary" onClick={() => setOpen(true)}>Add entry</button>}
      </div>
      {open && <div className="gap"><div className="grid2">
        <div className="fld"><label>Type</label><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Select…</option>{types.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="fld"><label>Date</label><input type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="fld full"><label>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Type 2 diabetes diagnosed" /></div>
        <div className="fld full"><label>Notes</label><textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div></div>
        <p className="muted">Entries cannot be edited or deleted once saved. Add a new entry to correct one.</p>
        <ErrorBox e={err} /><div className="row gap"><button className="primary" disabled={busy || !f.type || f.title.trim().length < 3} onClick={submit}>Save entry</button><button onClick={() => setOpen(false)}>Cancel</button></div></div>}
      <div className="chips gap">{["All", ...new Set((data.entries as any[]).map((e) => e.type))].map((t) => <button key={t as string} type="button" className={`chip${filter === t ? " on" : ""}`} onClick={() => setFilter(t as string)}>{t as string}</button>)}</div>
      {shown.length ? <div className="timeline gap">{shown.map((e) => (
        <div key={e.entryKey} className="ev"><b>{e.title}</b> <Badge v={e.type === "Diagnosis" ? "Active" : "Completed"} /> <span className="muted">{e.type}</span>
          <div className="muted">{fmtDate(e.date)} · {e.addedByName} ({e.addedByRole === "admin_nurse" ? "nurse" : e.addedByRole})</div>{e.notes && <div style={{ whiteSpace: "pre-wrap" }}>{e.notes}</div>}</div>))}</div>
        : <p className="muted">No history recorded yet.</p>}

      <h3 className="gap">Visits{data.appointments.length ? "" : ""}</h3>
      {data.appointments.length ? <table><thead><tr><th>When</th><th>Doctor</th><th>Status</th><th>Reason</th></tr></thead><tbody>
        {data.appointments.map((a: any) => <tr key={a.id}><td>{fmtDateTime(a.slotStart)}</td><td>{a.doctorName}</td><td><Badge v={a.status} /></td><td>{a.reason ?? "—"}</td></tr>)}</tbody></table>
        : <p className="muted">No visits on record.</p>}
      {data.adherence30 && <p className="muted gap">30-day medicine adherence: <b>{data.adherence30.percent === null ? "not enough data" : `${data.adherence30.percent}%`}</b></p>}
    </div>
  );
}
