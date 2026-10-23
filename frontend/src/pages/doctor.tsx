import { useState } from "react";
import { Link } from "react-router-dom";
import { get, put } from "../api";
import { useAuth } from "../auth";
import { Badge, ErrorBox, useLoad } from "../components";
import { MessagePatientButton } from "./Chat";

export function DoctorPatients() {
  const [q, setQ] = useState(""); const { data, error } = useLoad(() => get<any[]>(`/patients?q=${encodeURIComponent(q)}`), [q]);
  const scans = useLoad(() => get<any[]>("/scans"), [], 20000); const waiting = scans.data?.filter((s) => s.status === "Pending review").length ?? 0;
  return (
    <div><h1>My patients</h1><ErrorBox e={scans.error} />
      <div className="kpis">
        <div className="kpi k-mint"><span className="lbl">Patients</span><span className="n">{data?.length ?? "…"}</span></div>
        <div className="kpi k-sun sq"><span className="lbl">Uploads to review</span><span className="n">{waiting}</span></div>
        <div className="kpi k-ink tri"><span className="lbl">Low adherence</span><span className="n">{data ? data.filter((p) => p.flags?.lowAdherence).length : "…"}</span><small>below 70% this week</small></div>
      </div>
      <input placeholder="Search patients" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 14 }} />
      {waiting > 0 && <div className="card" style={{ borderColor: "var(--accent)" }}><h2>{waiting} prescription upload{waiting === 1 ? "" : "s"} waiting for your review</h2>{scans.data!.filter((s) => s.status === "Pending review").slice(0, 5).map((s) => <div className="row gap" key={s.id} style={{ alignItems: "center" }}><div className="grow"><b>{s.patientName}</b> <span className="muted">{s.items.length ? s.items.map((i: any) => i.drugName ?? i.rawName).join(", ") : "photo only, enter medicines yourself"}</span></div><Link to={`/scans/${s.id}`}><button className="primary sm">Review</button></Link></div>)}<p><Link to="/scans">All uploads</Link></p></div>}<ErrorBox e={error} />
      <div className="card gap"><table><thead><tr><th>Patient</th><th>Conditions</th><th>Adherence (7d)</th><th>Flags</th><th aria-label="Actions" /></tr></thead><tbody>
        {data?.map((p) => <tr key={p.id} className={p.emergency?.active ? "sos-row" : undefined}><td><Link to={`/patient/${p.id}`}>{p.name}</Link>{p.emergency?.active && <> <Link to="/messages" className="sos-tag">Emergency</Link></>}</td><td>{p.conditions?.join(", ") || "—"}</td>
          <td>{p.flags?.adherence == null ? <span className="muted">—</span> : <><b>{p.flags.adherence}%</b> {p.flags.lowAdherence && <Badge v="Missed" />}</>}</td>
          <td>{p.flags?.allergies ? <Badge v="Pending" /> : null} {p.flags?.allergies ? `${p.flags.allergies} allergy` : ""}</td><td className="actions"><MessagePatientButton patientId={p.id} small label="Message" /></td></tr>)}
        {data && !data.length && <tr><td colSpan={4} className="muted">No assigned patients yet</td></tr>}</tbody></table></div>
    </div>
  );
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const toText = (w: { start: string; end: string }[] = []) => w.map((x) => `${x.start}-${x.end}`).join(", ");
const parse = (t: string) => t.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(s); if (!m) throw new Error(`Bad time range "${s}" (use HH:MM-HH:MM)`); return { start: m[1], end: m[2] }; });

export function DoctorAvailability() {
  const { me } = useAuth(); const { data, error, reload } = useLoad(() => get<any>(`/doctors/${me!.sub}`));
  const [state, setState] = useState<any>(null); const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState("");
  if (data && !state) setState({ slot: data.availability.slotMinutes, hours: Object.fromEntries(DAYS.map((d) => [d, toText(data.availability.weeklyHours[d])])), breaks: toText(data.availability.breaks), leave: data.availability.leaveDates.join(", ") });
  if (!data || !state) return <ErrorBox e={error} />;
  const save = async () => {
    setErr(null); setOk("");
    try {
      const weeklyHours: any = {}; DAYS.forEach((d) => { const w = parse(state.hours[d]); if (w.length) weeklyHours[d] = w; });
      await put(`/doctors/${me!.sub}`, { availability: { slotMinutes: Number(state.slot), weeklyHours, breaks: parse(state.breaks), leaveDates: state.leave.split(",").map((s: string) => s.trim()).filter(Boolean) } });
      setOk("Availability saved. Patients now see updated slots."); reload();
    } catch (e) { setErr(e); }
  };
  const status = async (s: string) => { await put(`/doctors/${me!.sub}`, { onlineStatus: s }); reload(); };
  return (
    <div><h1>Availability</h1>
      <div className="card"><h2>Status</h2><div className="row">{["Available", "Busy", "Offline"].map((s) => <button key={s} className={data.onlineStatus === s ? "primary" : ""} onClick={() => status(s)}>{s}</button>)}</div></div>
      <div className="card"><h2>Weekly hours (IST)</h2><p className="muted">Comma-separated ranges, e.g. 09:00-13:00, 16:00-19:00. Leave blank for a day off.</p>
        {DAYS.map((d) => <div className="row" key={d}><div style={{ width: 50 }}><b>{d}</b></div><div className="grow"><input value={state.hours[d]} onChange={(e) => setState({ ...state, hours: { ...state.hours, [d]: e.target.value } })} /></div></div>)}
        <div className="row gap"><div className="field"><label>Slot length (minutes)</label><input type="number" value={state.slot} onChange={(e) => setState({ ...state, slot: e.target.value })} /></div>
          <div className="field"><label>Breaks</label><input value={state.breaks} onChange={(e) => setState({ ...state, breaks: e.target.value })} /></div>
          <div className="field"><label>Leave dates (YYYY-MM-DD, comma-separated)</label><input value={state.leave} onChange={(e) => setState({ ...state, leave: e.target.value })} /></div></div>
        <ErrorBox e={err} />{ok && <div className="success">{ok}</div>}<button className="primary gap" onClick={save}>Save availability</button></div>
    </div>
  );
}
