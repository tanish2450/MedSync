import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, post } from "../api";
import { AlertList, Badge, ErrorBox, fmtDateTime, useLoad } from "../components";
import { DoctorScan, PageBanner } from "../illustrations";
import { DrugSearch, useAckFlow } from "./Prescribe";
import { FrequencyPicker, defaultSchedule, type Schedule } from "./FrequencyPicker";

interface Drug { drugId: string; genericName: string; brandNames: string[]; forms: { form: string; strengths: string[] }[]; classes: string[] }
interface Line {
  key: number; rawName: string; drug: Drug | null; form: string; strength: string; dose: string; schedule: Schedule; durationDays: number | ""; instructions: string;
  flags: Set<string>; include: boolean; readFrequency: string | null;
}
const LABEL: Record<string, string> = { drug: "medicine", form: "form", strength: "strength", dose: "dose", frequency: "how often", durationDays: "number of days" };

export function DoctorScans() {
  const { data, error } = useLoad(() => get<any[]>("/scans"), [], 20000);
  const pending = data?.filter((s) => s.status === "Pending review") ?? []; const rest = data?.filter((s) => s.status !== "Pending review") ?? [];
  const Table = ({ rows }: { rows: any[] }) => <table><thead><tr><th>Uploaded</th><th>Patient</th><th>Medicines read</th><th>Status</th><th /></tr></thead><tbody>
    {rows.map((s) => <tr key={s.id}><td>{fmtDateTime(s.createdAt)}</td><td>{s.patientName}</td><td>{s.items.length || <span className="muted">none, enter from photo</span>}</td><td><Badge v={s.status === "Added" ? "Confirmed" : s.status === "Rejected" ? "Missed" : "Pending"} /> {s.status}</td>
      <td><Link to={`/scans/${s.id}`}><button className="sm primary">{s.status === "Pending review" ? "Review" : "View"}</button></Link></td></tr>)}
    {!rows.length && <tr><td colSpan={5} className="muted">None</td></tr>}</tbody></table>;
  return (<div><PageBanner title="Prescription uploads" sub="Photos patients sent in. Check what was read, then add the medicines to their plan." art={<DoctorScan />} /><ErrorBox e={error} />
    <div className="card"><h2>Waiting for your review ({pending.length})</h2><Table rows={pending} /></div>
    <div className="card"><h2>Reviewed</h2><Table rows={rest} /></div></div>);
}

export function ScanReview() {
  const { id } = useParams(); const nav = useNavigate();
  const { data, error } = useLoad(() => get<any>(`/scans/${id}`), [id]);
  if (error) return <ErrorBox e={error} />;
  if (!data) return <p>Loading…</p>;
  return <ReviewBody key={data.id} scan={data} done={() => nav("/scans")} />;
}

function ReviewBody({ scan, done }: { scan: any; done: () => void }) {
  const open = scan.status === "Pending review";
  const [lines, setLines] = useState<Line[]>(() => scan.items.map((it: any, i: number): Line => {
    const drug: Drug | null = it.drug ?? null;
    const flags = new Set<string>(it.missing);
    const sched: Schedule = it.frequency && it.timings ? { frequency: it.frequency, timings: it.timings } : defaultSchedule();
    return { key: i, rawName: it.rawName, drug, form: it.form ?? drug?.forms[0]?.form ?? "", strength: it.strength ?? "", dose: it.dose ?? "", schedule: sched, durationDays: it.durationDays ?? "", instructions: it.instructions ?? "", flags, include: true, readFrequency: it.frequencyRaw };
  }));
  const flow = useAckFlow(); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [reason, setReason] = useState(""); const [rejecting, setRejecting] = useState(false);
  const upd = (key: number, p: Partial<Line>, clear: string[] = []) => setLines((ls) => ls.map((l) => { if (l.key !== key) return l; const flags = new Set(l.flags); clear.forEach((c) => flags.delete(c)); return { ...l, ...p, flags }; }));
  const included = lines.filter((l) => l.include);
  const blocking = useMemo(() => included.reduce((n, l) => n + l.flags.size + (l.drug ? 0 : 1) + (l.drug && (!l.strength || !l.dose.trim() || !l.durationDays) ? 1 : 0), 0), [included]);
  const nextKey = () => Math.max(-1, ...lines.map((l) => l.key)) + 1;
  const addManual = (d: Drug) => setLines((ls) => [...ls, { key: nextKey(), rawName: d.genericName, drug: d, form: d.forms[0].form, strength: d.forms[0].strengths[0], dose: "1 tablet", schedule: defaultSchedule(), durationDays: 7, instructions: "", flags: new Set(["frequency", "durationDays"]), include: true, readFrequency: null }]);
  const items = () => included.map((l) => ({ drugId: l.drug!.drugId, form: l.form, strength: l.strength, dose: l.dose, frequency: l.schedule.frequency, timings: l.schedule.timings, durationDays: Number(l.durationDays), instructions: l.instructions || undefined }));

  const check = async () => { setBusy(true); flow.setError(null); try { const r = await post(`/patients/${scan.patientId}/prescriptions/check`, { items: items() }); flow.setAlerts(r.alerts); setMsg(r.alerts.length ? "" : "No known interaction found in our database."); } catch (e) { flow.handle(e); } finally { setBusy(false); } };
  const finalise = async () => { setBusy(true); flow.setError(null); try { await post(`/patients/${scan.patientId}/prescriptions`, { items: items(), acknowledgements: flow.ackList(), scanId: scan.id }); done(); } catch (e) { flow.handle(e); } finally { setBusy(false); } };
  const reject = async () => { setBusy(true); try { await post(`/scans/${scan.id}/reject`, { reason }); done(); } catch (e) { flow.setError(e); } finally { setBusy(false); } };

  return (
    <div>
      <p><Link to="/scans">← All uploads</Link></p>
      <h1>Prescription from {scan.patientName}</h1>
      <p className="muted">Uploaded {fmtDateTime(scan.createdAt)}{scan.prescriberOnPaper ? ` · Name on paper: ${scan.prescriberOnPaper}` : ""}{scan.prescriptionDate ? ` · Dated ${scan.prescriptionDate}` : ""} · <Link to={`/patient/${scan.patientId}`}>Open patient record</Link></p>
      {scan.patientNote && <div className="card">Patient note: {scan.patientNote}</div>}
      <div className="disclaimer">These details were read automatically from a photo and can be wrong. Check every field against the image before adding anything to the patient&apos;s plan.</div>
      <div className="grid2 gap" style={{ alignItems: "start" }}>
        <div className="card"><h2>Photo</h2><a href={scan.image} target="_blank" rel="noreferrer"><img src={scan.image} alt="Uploaded prescription" style={{ width: "100%", borderRadius: 8 }} /></a><small className="muted">Click to open full size.</small></div>
        <div>
          {scan.extraction !== "ok" && <div className="error">{scan.extractionNote ?? "Nothing was read automatically."} Search the catalogue below to add the medicines yourself.</div>}
          {lines.map((l) => (
            <div key={l.key} className="card" style={{ opacity: l.include ? 1 : 0.5 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>{l.drug ? l.drug.genericName : `Unmatched: “${l.rawName}”`}{l.drug && l.rawName && l.rawName.toLowerCase() !== l.drug.genericName.toLowerCase() && <span className="muted"> (written as “{l.rawName}”)</span>}</h3>
                <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={l.include} onChange={(e) => upd(l.key, { include: e.target.checked })} /> Add</label>
              </div>
              {l.include && <>
                {!l.drug && <div className="gap"><div className="error">This name is not in the catalogue or matches several medicines. Pick the correct medicine.</div>
                  <DrugSearch onPick={(d) => setLines((ls) => ls.map((x) => x.key !== l.key ? x : { ...x, drug: d, form: d.forms[0].form, strength: d.forms[0].strengths.includes(x.strength) ? x.strength : "", flags: new Set([...x.flags].filter((f) => f !== "drug" && f !== "form" && f !== "strength").concat(d.forms[0].strengths.includes(x.strength) ? [] : ["strength"])) }))} /></div>}
                {l.drug && <div className="grid2 gap">
                  <Fld label="Form" bad={l.flags.has("form")}><select value={l.form} onChange={(e) => upd(l.key, { form: e.target.value, strength: "" }, ["form"])}>{l.drug.forms.map((f) => <option key={f.form}>{f.form}</option>)}</select></Fld>
                  <Fld label="Strength" bad={l.flags.has("strength") || !l.strength}><select value={l.strength} onChange={(e) => upd(l.key, { strength: e.target.value }, ["strength"])}><option value="">Select…</option>{(l.drug.forms.find((f) => f.form === l.form)?.strengths ?? []).map((s) => <option key={s}>{s}</option>)}</select></Fld>
                  <Fld label="Dose each time" bad={l.flags.has("dose")}><input value={l.dose} placeholder="e.g. 1 tablet" onChange={(e) => upd(l.key, { dose: e.target.value }, ["dose"])} /></Fld>
                  <Fld label="Number of days" bad={l.flags.has("durationDays")}><input type="number" min={1} max={730} value={l.durationDays} onChange={(e) => upd(l.key, { durationDays: e.target.value === "" ? "" : Number(e.target.value) }, ["durationDays"])} /></Fld>
                  <div className="full" style={{ gridColumn: "1/-1" }}>
                    {l.flags.has("frequency") && <div className="warn">{l.readFrequency ? `Could not understand “${l.readFrequency}”.` : "Frequency not found on the prescription."} Choose how often and the reminder times.</div>}
                    <FrequencyPicker value={l.schedule} onChange={(s) => upd(l.key, { schedule: s }, ["frequency"])} />
                  </div>
                  <Fld label="Instructions" full><input value={l.instructions} onChange={(e) => upd(l.key, { instructions: e.target.value })} /></Fld>
                </div>}
                {l.flags.size > 0 && l.drug && <small className="err">Please fill in: {[...l.flags].map((f) => LABEL[f] ?? f).join(", ")}</small>}
              </>}
            </div>))}
          {open && <div className="card"><DrugSearch onPick={addManual} /><small className="muted">Add a medicine that was not read from the photo.</small></div>}
          <ErrorBox e={flow.error} />{msg && <div className="success">{msg}</div>}
          {open && included.length > 0 && <div className="gap"><AlertList alerts={flow.alerts} acks={flow.acks} setAck={flow.setAck} />
            <div className="row gap"><button onClick={check} disabled={busy || blocking > 0}>Check interactions</button>
              <button className="primary" onClick={finalise} disabled={busy || blocking > 0}>Add {included.length} medicine{included.length === 1 ? "" : "s"} to patient</button></div>
            {blocking > 0 && <small className="err">{blocking} detail{blocking === 1 ? "" : "s"} still need your input before this can be added.</small>}</div>}
          {open && <div className="gap">{!rejecting ? <button className="danger" onClick={() => setRejecting(true)}>Reject this upload</button> : <div className="card"><label>Reason (the patient will see this)</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not my prescription / photo unreadable" />
            <div className="row gap"><button className="danger" disabled={busy || reason.trim().length < 3} onClick={reject}>Reject</button><button onClick={() => setRejecting(false)}>Cancel</button></div></div>}</div>}
          {!open && <div className="card"><Badge v={scan.status === "Added" ? "Confirmed" : "Missed"} /> {scan.status}{scan.rejectReason ? ` — ${scan.rejectReason}` : ""}</div>}
        </div>
      </div>
    </div>
  );
}

function Fld({ label, bad, full, children }: { label: string; bad?: boolean; full?: boolean; children: React.ReactNode }) {
  return <div className={`fld${full ? " full" : ""}`} style={bad ? { outline: "2px solid #d97706", outlineOffset: 4, borderRadius: 6 } : undefined}><label>{label}{bad ? " ⚠ not read from the photo" : ""}</label>{children}</div>;
}
