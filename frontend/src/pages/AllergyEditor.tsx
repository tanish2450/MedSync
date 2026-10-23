import { useState } from "react";
import { put } from "../api";
import { ErrorBox } from "../components";

interface Allergy { substance: string; reaction?: string }
/** Patients and linked caregivers keep allergies up to date; doctors see them before every prescription. */
export function AllergyEditor({ patientId, allergies, onSaved }: { patientId: string; allergies: Allergy[]; onSaved: () => void }) {
  const [edit, setEdit] = useState(false); const [rows, setRows] = useState<Allergy[]>([]); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const start = () => { setRows(allergies.length ? allergies.map((a) => ({ ...a })) : [{ substance: "", reaction: "" }]); setErr(null); setEdit(true); };
  const save = async () => {
    setBusy(true); setErr(null);
    try { await put(`/patients/${patientId}/clinical`, { allergies: rows.filter((r) => r.substance.trim()) }); setEdit(false); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="card"><div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h2 style={{ margin: 0 }}>Allergies</h2>{!edit && <button className="sm" onClick={start}>Edit</button>}</div>
      {!edit ? (allergies.length ? allergies.map((a, i) => <div key={i} className="gap"><b>{a.substance}</b>{a.reaction ? ` — ${a.reaction}` : ""}</div>) : <p className="muted">None recorded. Add any medicine, food or other allergy so doctors are warned before prescribing.</p>)
        : <div className="gap">
          {rows.map((r, i) => (
            <div className="row" key={i} style={{ gap: 8, marginBottom: 8 }}>
              <input placeholder="Allergic to (e.g. Penicillin)" value={r.substance} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, substance: e.target.value } : x)))} />
              <input placeholder="Reaction (e.g. rash)" value={r.reaction ?? ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reaction: e.target.value } : x)))} />
              <button type="button" className="sm" aria-label="Remove allergy" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            </div>))}
          <button type="button" className="sm" onClick={() => setRows([...rows, { substance: "", reaction: "" }])}>+ Add another</button>
          <ErrorBox e={err} /><div className="row gap"><button className="primary" disabled={busy} onClick={save}>Save allergies</button><button onClick={() => setEdit(false)}>Cancel</button></div></div>}
    </div>
  );
}
