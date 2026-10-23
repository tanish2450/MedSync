import { useState } from "react";
import { ApiError, get, post } from "../api";
import { AlertList, ErrorBox, Modal, useLoad, type AlertT } from "../components";
import { FrequencyPicker, defaultSchedule } from "./FrequencyPicker";

interface Drug { drugId: string; genericName: string; brandNames: string[]; forms: { form: string; strengths: string[] }[]; classes: string[] }
interface Line { drug: Drug; form: string; strength: string; dose: string; frequency: string; timings?: string[]; durationDays: number; instructions: string }

/** Drug search against the real catalogue only (free-text drugs are rejected by the API). */
export function DrugSearch({ onPick }: { onPick: (d: Drug) => void }) {
  const [q, setQ] = useState("");
  const { data } = useLoad(() => (q.length >= 2 ? get<Drug[]>(`/drugs?q=${encodeURIComponent(q)}&limit=8`) : Promise.resolve([] as Drug[])), [q]);
  return (
    <div>
      <label>Search drug catalogue (generic or brand)</label>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. ibuprofen, Dolo, statin" />
      {data?.map((d) => (
        <div key={d.drugId} className="row gap"><div className="grow"><b>{d.genericName}</b> <span className="muted">{d.brandNames.join(", ")} · {d.classes[0]}</span></div>
          <button onClick={() => { onPick(d); setQ(""); }}>Select</button></div>
      ))}
    </div>
  );
}

export function useAckFlow() {
  const [alerts, setAlerts] = useState<AlertT[]>([]); const [acks, setAcks] = useState<Record<string, string>>({}); const [error, setError] = useState<unknown>(null);
  const ackList = () => Object.entries(acks).filter(([, r]) => r.trim().length >= 3).map(([key, reason]) => ({ key, reason }));
  const handle = (e: unknown) => { if (e instanceof ApiError && e.status === 409 && e.details?.alerts) { setAlerts(e.details.alerts); setError(null); } else setError(e); };
  return { alerts, setAlerts, acks, setAck: (k: string, v: string) => setAcks((a) => ({ ...a, [k]: v })), ackList, error, setError, handle };
}

export function Prescribe({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([]); const flow = useAckFlow(); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const add = (d: Drug) => setLines((l) => [...l, { drug: d, form: d.forms[0].form, strength: d.forms[0].strengths[0], dose: "1 tablet", ...defaultSchedule(), durationDays: 7, instructions: "" }]);
  const upd = (i: number, p: Partial<Line>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const items = () => lines.map((l) => ({ drugId: l.drug.drugId, form: l.form, strength: l.strength, dose: l.dose, frequency: l.frequency, timings: l.timings, durationDays: Number(l.durationDays), instructions: l.instructions || undefined }));

  const check = async () => { setBusy(true); flow.setError(null); try { const r = await post(`/patients/${patientId}/prescriptions/check`, { items: items() }); flow.setAlerts(r.alerts); setMsg(r.alerts.length ? "" : "Checked."); } catch (e) { flow.handle(e); } finally { setBusy(false); } };
  const finalise = async () => {
    setBusy(true); flow.setError(null);
    try { await post(`/patients/${patientId}/prescriptions`, { items: items(), acknowledgements: flow.ackList() }); setLines([]); flow.setAlerts([]); setMsg("Prescription saved."); onDone(); }
    catch (e) { flow.handle(e); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Prescribe</h2>
      <DrugSearch onPick={add} />
      {lines.map((l, i) => (
        <div key={i} className="card gap">
          <div className="row"><h3 className="grow">{l.drug.genericName}</h3><button onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button></div>
          <div className="row">
            <div className="field"><label>Form</label><select value={l.form} onChange={(e) => upd(i, { form: e.target.value, strength: l.drug.forms.find((f) => f.form === e.target.value)!.strengths[0] })}>{l.drug.forms.map((f) => <option key={f.form}>{f.form}</option>)}</select></div>
            <div className="field"><label>Strength</label><select value={l.strength} onChange={(e) => upd(i, { strength: e.target.value })}>{l.drug.forms.find((f) => f.form === l.form)!.strengths.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="field"><label>Dose</label><input value={l.dose} onChange={(e) => upd(i, { dose: e.target.value })} /></div>
            <div className="field"><label>Days</label><input type="number" min={1} max={730} value={l.durationDays} onChange={(e) => upd(i, { durationDays: Number(e.target.value) })} /></div>
          </div>
          <FrequencyPicker value={{ frequency: l.frequency, timings: l.timings }} onChange={(s) => upd(i, s)} />
          <label className="gap">Instructions</label><input value={l.instructions} onChange={(e) => upd(i, { instructions: e.target.value })} />
        </div>
      ))}
      <ErrorBox e={flow.error} />{msg && <div className="success">{msg}</div>}
      {lines.length > 0 && <div className="gap"><AlertList alerts={flow.alerts} acks={flow.acks} setAck={flow.setAck} />
        <div className="row gap"><button onClick={check} disabled={busy}>Check interactions</button><button className="primary" onClick={finalise} disabled={busy}>Finalise prescription</button></div>
        <div className="disclaimer">Interactions are checked again on the server when you finalise. Major / contraindicated alerts need an acknowledgement reason.</div></div>}
    </div>
  );
}

export function ModifyDialog({ patientId, med, onClose, onDone }: { patientId: string; med: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ dose: med.dose, frequency: med.frequency, durationDays: med.durationDays, strength: med.strength, instructions: med.instructions ?? "", reason: "", timings: (med.timings ?? med.reminderTimes) as string[] | undefined });
  const flow = useAckFlow(); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await post(`/patients/${patientId}/medications/${med.itemId}/modify`, { changes: { ...f, durationDays: Number(f.durationDays) }, reason: f.reason, acknowledgements: flow.ackList() }); onDone(); onClose(); }
    catch (e) { flow.handle(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Modify ${med.drugName}`} onClose={onClose}>
      <div className="row">
        {(["strength", "dose"] as const).map((k) => <div key={k} className="field"><label>{k}</label><input value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
        <div className="field"><label>Total days</label><input type="number" value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: Number(e.target.value) })} /></div>
      </div>
      <FrequencyPicker value={{ frequency: f.frequency, timings: f.timings }} onChange={(s) => setF({ ...f, ...s })} />
      <label className="gap">Reason for change (required, kept in history)</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      <ErrorBox e={flow.error} /><AlertList alerts={flow.alerts} acks={flow.acks} setAck={flow.setAck} />
      <button className="primary gap" disabled={busy || !f.reason.trim()} onClick={save}>Save new version</button>
    </Modal>
  );
}

export function DiscontinueDialog({ patientId, med, onClose, onDone }: { patientId: string; med: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title={`Discontinue ${med.drugName}`} onClose={onClose}>
      <label>Reason (required; the record stays in history)</label><input value={reason} onChange={(e) => setReason(e.target.value)} />
      <ErrorBox e={err} />
      <button className="danger gap" disabled={!reason.trim()} onClick={async () => { try { await post(`/patients/${patientId}/medications/${med.itemId}/discontinue`, { reason }); onDone(); onClose(); } catch (e) { setErr(e); } }}>Discontinue</button>
    </Modal>
  );
}
