import { useRef, useState } from "react";
import { get, post } from "../api";
import { Badge, ErrorBox, Modal, fmtDateTime, useLoad } from "../components";

/** Downscale to ~1600px JPEG so phone photos stay small enough to upload and read quickly. */
async function compress(file: File): Promise<{ b64: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.82);
  return { b64: url.split(",")[1], preview: url };
}
const statusLabel: Record<string, string> = { "Pending review": "Waiting for doctor", Added: "Added to your medicines", Rejected: "Not accepted" };

export function PrescriptionUpload() {
  const docs = useLoad(() => get<any[]>("/doctors")); const scans = useLoad(() => get<any[]>("/scans"), [], 20000);
  const [img, setImg] = useState<{ b64: string; preview: string } | null>(null); const [doctorId, setDoctorId] = useState(""); const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [done, setDone] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null); const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (f?: File) => { setErr(null); if (!f) return; try { setImg(await compress(f)); } catch { setErr("That file could not be opened as a photo. Try a JPEG or PNG."); } };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { const r = await post("/scans", { imageBase64: img!.b64, doctorId, note, consent }); setDone(r); setImg(null); setNote(""); setConsent(false); if (fileRef.current) fileRef.current.value = ""; scans.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="narrow">
      <h1>Upload a prescription</h1>
      <p className="muted">Take a clear photo of your prescription. We read the medicines, then the doctor who prescribed them checks the details and adds them to your plan, with reminders.</p>
      <div className="card">
        {!img ? <>
          <label>Photo of the prescription</label>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => pick(e.target.files?.[0])} />
        </> : <>
          <img src={img.preview} alt="Prescription preview" style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8 }} />
          <div><button className="sm gap" onClick={() => { setImg(null); if (fileRef.current) fileRef.current.value = ""; }}>Choose a different photo</button></div>
        </>}
        <div className="fld gap"><label>Doctor who prescribed these medicines</label>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">Select a doctor…</option>{docs.data?.filter((d) => d.active !== false).map((d) => <option key={d.id} value={d.id}>{d.name} — {d.specialty}{d.clinic?.name ? ` (${d.clinic.name})` : ""}</option>)}</select>
          <small className="muted">Not listed? That doctor is not on MedSync yet. Ask them to join, or ask your clinic to add them.</small></div>
        <div className="fld gap"><label>Note for the doctor (optional)</label><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I agree that this photo is read by an AI service (Groq) and shared with the doctor I selected, who will be able to see my health record.</label>
        <ErrorBox e={err} />
        <button className="primary gap" disabled={busy || !img || !doctorId || !consent} onClick={submit}>{busy ? "Reading your prescription… this can take 20 seconds" : "Upload and send to doctor"}</button>
        {done && <div className="success gap">Sent to {done.doctorName}. {done.items.length ? `We read ${done.items.length} medicine${done.items.length === 1 ? "" : "s"}; ` : ""}{done.extractionNote ?? "your doctor will check them and add them to your plan."}</div>}
      </div>

      <div className="card gap"><h2>My uploads</h2>
        {scans.data?.length ? <table><thead><tr><th>When</th><th>Doctor</th><th>Medicines read</th><th>Status</th><th /></tr></thead><tbody>
          {scans.data.map((s) => <tr key={s.id}><td>{fmtDateTime(s.createdAt)}</td><td>{s.doctorName}</td><td>{s.items.length || "—"}</td><td><Badge v={s.status === "Added" ? "Confirmed" : s.status === "Rejected" ? "Missed" : "Pending"} /> {statusLabel[s.status]}{s.rejectReason ? <div className="muted">{s.rejectReason}</div> : null}</td>
            <td><button className="sm" onClick={() => setOpen(s.id)}>View</button></td></tr>)}</tbody></table> : <p className="muted">No uploads yet.</p>}
      </div>
      {open && <ScanPreview id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ScanPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useLoad(() => get<any>(`/scans/${id}`), [id]);
  return (
    <Modal title="Prescription upload" onClose={onClose}>
      <ErrorBox e={error} />
      {data && <>
        <img src={data.image} alt="Uploaded prescription" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8 }} />
        <h3 className="gap">What we read</h3>
        {data.items.length ? <ul>{data.items.map((it: any, i: number) => <li key={i}><b>{it.drugName ?? it.rawName}</b> {[it.strength, it.dose, it.frequencyRaw, it.durationDays && `${it.durationDays} days`].filter(Boolean).join(" · ")}</li>)}</ul> : <p className="muted">{data.extractionNote ?? "Nothing was read automatically."}</p>}
        <p className="muted">Your doctor checks and completes these details before anything is added to your plan.</p>
      </>}
    </Modal>
  );
}
