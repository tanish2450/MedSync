import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, post, put } from "../api";
import { useAuth } from "../auth";
import { Badge, Empty, ErrorBox, Modal, Skeleton, fmtDate, fmtDateTime, useLoad } from "../components";
import { IlloEmpty, LabReport, LabTech, PageBanner } from "../illustrations";
import { DirectionsLink, MapEmbed, useHere } from "../maps";

export interface AnalyteT { key: string; name: string; unit: string; low?: number; high?: number; critLow?: number; critHigh?: number; text?: boolean }
export interface LabTestT { code: string; name: string; sample: string; fasting?: boolean; tatHours: number; analytes: AnalyteT[] }
export interface LabT { id: string; name: string; address: string; lat: number; lng: number; phone: string; hours: string; tests: string[]; homeCollection: boolean; verified?: boolean; active: boolean }
interface ResultT { code: string; key: string; name: string; unit: string; value: number | string; low?: number; high?: number; flag: string }
export interface LabOrderT {
  id: string; patientId: string; patientName: string; doctorId: string; doctorName: string; tests: { code: string; name: string }[];
  priority: "Routine" | "Urgent"; fasting: boolean; clinicalNotes?: string; labId?: string; labName?: string; collection?: string; address?: string;
  status: "Ordered" | "Sample collected" | "Processing" | "Report ready" | "Cancelled"; history: { status: string; at: string; by: string }[];
  results?: ResultT[]; reportNote?: string; reportedAt?: string; reportedBy?: string; abnormal?: number; critical?: number; hasAttachment?: boolean; cancelReason?: string; createdAt: string;
  /** Present only for doctors. */
  aiReview?: AiReviewT;
}
type Urgency = "Immediate" | "Soon" | "Routine";
type AiReviewT =
  | { status: "ready"; summary: string; findings: { finding: string; significance: string }[]; suggestions: { action: string; rationale: string; urgency: Urgency }[]; followUpTests: string[]; cautions: string[]; model: string; generatedAt: string }
  | { status: "unavailable"; reason: string; generatedAt: string };
const STEPS = ["Ordered", "Sample collected", "Processing", "Report ready"] as const;
const km = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => (d * Math.PI) / 180; const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
  return 12742 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2));
};
/** Preview only — the server recomputes every flag when results are saved. */
const previewFlag = (v: number, a: AnalyteT, low?: number, high?: number) =>
  a.critLow !== undefined && v <= a.critLow ? "Critical low" : a.critHigh !== undefined && v >= a.critHigh ? "Critical high"
    : low !== undefined && v < low ? "Low" : high !== undefined && v > high ? "High" : "Normal";
const range = (r: { low?: number; high?: number }) => (r.low !== undefined && r.high !== undefined ? `${r.low} – ${r.high}` : r.low !== undefined ? `≥ ${r.low}` : r.high !== undefined ? `≤ ${r.high}` : "—");
export const Flag = ({ f }: { f: string }) => <span className={`flag f-${f.replace(/\s/g, "-")}`}>{f}</span>;

async function openAttachment(id: string) {
  const { mime, base64 } = await get<{ mime: string; base64: string }>(`/lab-orders/${id}/attachment`);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), "_blank", "noopener");
}

export function LabSteps({ o }: { o: LabOrderT }) {
  if (o.status === "Cancelled") return <div className="muted">Cancelled{o.cancelReason ? `: ${o.cancelReason}` : ""}</div>;
  const at = STEPS.indexOf(o.status);
  return <ol className="stepper">{STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : ""}>{s}</li>)}</ol>;
}

export function ResultsTable({ o }: { o: LabOrderT }) {
  const [err, setErr] = useState<unknown>(null);
  if (!o.results?.length) return null;
  return (
    <div className="lab-results">
      {o.tests.map((t) => (
        <div key={t.code}><div className="lr-test">{t.name}</div>
          <table><thead><tr><th>Test</th><th>Result</th><th>Reference</th><th>Flag</th></tr></thead><tbody>
            {o.results!.filter((r) => r.code === t.code).map((r) => (
              <tr key={r.key} className={`lr-${r.flag.replace(/\s/g, "-")}`}><td>{r.name}</td><td><b>{r.value}</b> <span className="muted">{r.unit}</span></td><td className="muted">{range(r)} {r.unit}</td><td><Flag f={r.flag} /></td></tr>))}
          </tbody></table></div>))}
      {o.reportNote && <p className="muted"><b>Lab note:</b> {o.reportNote}</p>}
      <div className="row"><span className="muted">Reported {o.reportedAt ? fmtDateTime(o.reportedAt) : ""}{o.reportedBy ? ` by ${o.reportedBy}` : ""}{o.labName ? ` · ${o.labName}` : ""}</span>
        {o.hasAttachment && <button className="sm" onClick={() => openAttachment(o.id).catch(setErr)}>Open report file</button>}</div>
      <ErrorBox e={err} />
      <p className="disclaimer">Flags compare each value with the reference range. Your doctor interprets the results.</p>
    </div>
  );
}

const URGENCY_FLAG: Record<Urgency, string> = { Immediate: "Critical-high", Soon: "High", Routine: "Normal" };

/** Doctor only: Groq's suggestions on a finished report. Advisory; prescribing still goes through the safety checks. */
function AiReview({ o }: { o: LabOrderT }) {
  const [r, setR] = useState<AiReviewT | undefined>(o.aiReview); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const run = async () => { setBusy(true); setErr(null); try { setR((await post<LabOrderT>(`/lab-orders/${o.id}/ai-review`)).aiReview); } catch (x) { setErr(x); } finally { setBusy(false); } };
  return (
    <div className="ai-review">
      <div className="row" style={{ alignItems: "center" }}>
        <div className="grow"><b>AI suggestions</b> <span className="muted">· for your review, not shown to the patient</span></div>
        <button className="sm" disabled={busy} onClick={run}>{busy ? "Thinking…" : !r ? "Get suggestions" : r.status === "ready" ? "Regenerate" : "Retry"}</button>
      </div>
      <ErrorBox e={err} />
      {!r && !busy && <p className="muted">No suggestions yet.</p>}
      {r?.status === "unavailable" && <p className="muted">{r.reason}</p>}
      {r?.status === "ready" && <>
        {r.cautions.map((c, i) => <div key={i} className="warn">{c}</div>)}
        <p>{r.summary}</p>
        {r.findings.length > 0 && <><div className="lr-test">Findings</div><ul>{r.findings.map((f, i) => <li key={i}><b>{f.finding}</b>{f.significance ? ` — ${f.significance}` : ""}</li>)}</ul></>}
        {r.suggestions.length > 0 && <><div className="lr-test">Suggested next steps</div><ul className="ai-steps">{r.suggestions.map((s, i) => (
          <li key={i}><span className={`flag f-${URGENCY_FLAG[s.urgency]}`}>{s.urgency}</span> <b>{s.action}</b>{s.rationale ? <div className="muted">{s.rationale}</div> : null}</li>))}</ul></>}
        {r.followUpTests.length > 0 && <p><b>Tests to consider:</b> {r.followUpTests.join(", ")}</p>}
        <p className="disclaimer">AI-generated from this report, the patient's conditions, allergies and current medicines (no name or contact details are sent). It can be wrong: check it against your own judgement. Any medicine you prescribe still goes through MedSync's interaction and allergy checks. Generated {fmtDateTime(r.generatedAt)}.</p>
        <Link to={`/patient/${o.patientId}`}><button className="primary sm">Open patient record to act</button></Link>
      </>}
    </div>
  );
}

/** One lab order: what was ordered, where it is, and the report when ready. */
export function LabOrderCard({ o, who = "doctor", actions, open }: { o: LabOrderT; who?: "patient" | "doctor" | "both"; actions?: React.ReactNode; open?: boolean }) {
  const ready = o.status === "Report ready"; const { me } = useAuth();
  return (
    <details className={`labcard${o.priority === "Urgent" && !ready ? " urgent" : ""}${o.critical ? " critical" : ""}`} open={open}>
      <summary>
        <div className="grow">
          <div className="lc-title">{o.tests.map((t) => t.name).join(", ")}</div>
          <div className="muted">{who !== "doctor" ? `Ordered by ${o.doctorName}` : ""}{who === "both" ? " · " : ""}{who !== "patient" ? <>For <Link to={`/patient/${o.patientId}`} onClick={(e) => e.stopPropagation()}>{o.patientName}</Link></> : ""} · {fmtDate(o.createdAt)}{o.labName ? ` · ${o.labName}` : ""}</div>
        </div>
        {o.priority === "Urgent" && !ready && <span className="flag f-Critical-high">Urgent</span>}
        {ready && (o.critical ? <span className="flag f-Critical-high">{o.critical} critical</span> : o.abnormal ? <span className="flag f-High">{o.abnormal} abnormal</span> : <span className="flag f-Normal">All in range</span>)}
        <Badge v={ready ? "Completed" : o.status === "Cancelled" ? "Cancelled" : "Pending"} />
      </summary>
      <div className="lc-body">
        <LabSteps o={o} />
        {o.fasting && o.status === "Ordered" && <div className="warn">Fasting needed: no food for 8–10 hours before the sample (water is fine).</div>}
        {o.clinicalNotes && <p className="muted"><b>Doctor&apos;s note:</b> {o.clinicalNotes}</p>}
        {o.collection && <p className="muted">{o.collection}{o.address ? ` · ${o.address}` : ""}</p>}
        {ready && <ResultsTable o={o} />}
        {ready && me?.role === "doctor" && <AiReview o={o} />}
        {actions && <div className="row gap">{actions}</div>}
      </div>
    </details>
  );
}

/** Doctor: order tests for an assigned patient. */
export function OrderLabTests({ patientId, patientName, onClose, onDone }: { patientId: string; patientName: string; onClose: () => void; onDone: () => void }) {
  const tests = useLoad(() => get<LabTestT[]>("/lab-tests")); const labs = useLoad(() => get<LabT[]>("/labs"));
  const [sel, setSel] = useState<string[]>([]); const [priority, setPriority] = useState<"Routine" | "Urgent">("Routine");
  const [notes, setNotes] = useState(""); const [labId, setLabId] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const fitting = (labs.data ?? []).filter((l) => sel.every((c) => l.tests.includes(c)));
  const toggle = (c: string) => { setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c])); setLabId(""); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await post(`/patients/${patientId}/lab-orders`, { tests: sel, priority, clinicalNotes: notes || undefined, labId: labId || undefined }); onDone(); onClose(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Order lab tests · ${patientName}`} onClose={onClose}>
      {tests.loading ? <Skeleton lines={4} /> : <div className="testgrid">{(tests.data ?? []).map((t) => (
        <label key={t.code} className={`pick${sel.includes(t.code) ? " on" : ""}`}>
          <input type="checkbox" checked={sel.includes(t.code)} onChange={() => toggle(t.code)} />
          <div className="grow"><b>{t.name}</b><div className="muted">{t.sample} · results in ~{t.tatHours} h{t.fasting ? " · fasting" : ""}</div></div>
        </label>))}</div>}
      <label className="gap">Priority</label>
      <div className="seg">{(["Routine", "Urgent"] as const).map((p) => <button key={p} type="button" className={priority === p ? "on" : ""} onClick={() => setPriority(p)}>{p}</button>)}</div>
      <label className="gap">Clinical notes for the lab (optional)</label>
      <textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. On warfarin, check INR before dose change" />
      <label className="gap">Lab (optional — the patient can choose)</label>
      <select value={labId} onChange={(e) => setLabId(e.target.value)} disabled={!sel.length}>
        <option value="">Let the patient choose</option>{fitting.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.address}</option>)}</select>
      {sel.length > 0 && !fitting.length && !labs.loading && <small className="muted">No single lab offers all selected tests; the patient can split or you can order separately.</small>}
      <ErrorBox e={err ?? tests.error} />
      <button className="primary gap" disabled={!sel.length || busy} onClick={submit}>{busy ? "Ordering…" : `Order ${sel.length || ""} test${sel.length === 1 ? "" : "s"}`}</button>
    </Modal>
  );
}

/** Patient / caregiver: pick a lab that offers every test, walk-in or home collection. */
function ChooseLab({ o, onDone }: { o: LabOrderT; onDone: () => void }) {
  const labs = useLoad(() => get<LabT[]>("/labs")); const { here, msg, locate } = useHere();
  const [labId, setLabId] = useState(o.labId ?? ""); const [mode, setMode] = useState(o.collection ?? "Walk-in"); const [address, setAddress] = useState(o.address ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const list = (labs.data ?? []).filter((l) => o.tests.every((t) => l.tests.includes(t.code)))
    .map((l) => ({ ...l, dist: here ? km(here, [l.lat, l.lng]) : null })).sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  const lab = list.find((l) => l.id === labId);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await post(`/lab-orders/${o.id}/choose-lab`, { labId, collection: mode, address: mode === "Home collection" ? address : undefined }); onDone(); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  if (labs.loading) return <Skeleton lines={3} />;
  if (!list.length) return <Empty>No registered lab offers all of these tests yet. Ask your doctor or the nursing desk.</Empty>;
  return (
    <div className="chooselab">
      <div className="row" style={{ alignItems: "center" }}><b className="grow">Choose a lab</b><button className="sm" onClick={locate}>Sort by nearest</button></div>
      {msg && <small className="muted">{msg}</small>}
      {list.map((l) => (
        <label key={l.id} className={`pick${labId === l.id ? " on" : ""}`}>
          <input type="radio" name={`lab-${o.id}`} checked={labId === l.id} onChange={() => { setLabId(l.id); if (!l.homeCollection) setMode("Walk-in"); }} />
          <div className="grow"><b>{l.name}</b>{l.verified === false && <span className="muted"> · Unverified</span>}<div className="muted">{l.address} · {l.hours}{l.homeCollection ? " · Home collection" : ""}</div></div>
          {l.dist !== null && <span className="muted">{l.dist.toFixed(1)} km</span>}
        </label>))}
      {lab && <>
        <MapEmbed key={lab.id} place={lab} height={200} />
        <div className="seg gap">{["Walk-in", ...(lab.homeCollection ? ["Home collection"] : [])].map((m) => <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m}</button>)}</div>
        {mode === "Home collection" ? <><label className="gap">Address for sample collection</label><textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></> : <div className="gap"><DirectionsLink place={lab} label="Directions to the lab" /></div>}
      </>}
      <ErrorBox e={err} />
      <button className="primary gap" disabled={!labId || busy} onClick={save}>{busy ? "Saving…" : "Confirm lab"}</button>
    </div>
  );
}

/** Shows the chosen lab with directions; the full picker only when no lab is set or the patient wants to change it. */
function LabChoice({ o, onDone }: { o: LabOrderT; onDone: () => void }) {
  const [changing, setChanging] = useState(!o.labId);
  const labs = useLoad(() => (o.labId ? get<LabT[]>("/labs") : Promise.resolve([] as LabT[])), [o.labId]);
  const lab = labs.data?.find((l) => l.id === o.labId);
  if (changing) return <ChooseLab o={o} onDone={() => { setChanging(false); onDone(); }} />;
  return (
    <div className="chooselab">
      <div className="row" style={{ alignItems: "center" }}><div className="grow"><b>{o.labName}</b><div className="muted">{lab?.address ?? ""}{lab?.hours ? ` · ${lab.hours}` : ""}</div></div>
        <button className="sm" onClick={() => setChanging(true)}>Change lab</button></div>
      {o.collection === "Home collection" ? <p className="muted">The lab will collect the sample at {o.address}.</p> : lab && <div className="gap"><DirectionsLink place={lab} label="Directions to the lab" /></div>}
    </div>
  );
}

/** Compact list of a patient's lab orders; used on the patient record (doctor / nurse) and the caregiver view. */
export function LabReportsCard({ patientId, patientName, canOrder }: { patientId: string; patientName: string; canOrder?: boolean }) {
  const { data, error, loading, reload } = useLoad(() => get<LabOrderT[]>(`/patients/${patientId}/lab-orders`), [patientId]);
  const [ordering, setOrdering] = useState(false);
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center" }}><h2 className="grow" style={{ margin: 0 }}>Lab reports</h2>{canOrder && <button className="primary sm" onClick={() => setOrdering(true)}>Order lab tests</button>}</div>
      <ErrorBox e={error} />
      <div className="gap">{loading ? <Skeleton lines={2} /> : data?.length ? data.map((o) => <LabOrderCard key={o.id} o={o} who="patient" />) : <Empty>No lab tests yet.</Empty>}</div>
      {ordering && <OrderLabTests patientId={patientId} patientName={patientName} onClose={() => setOrdering(false)} onDone={reload} />}
    </div>
  );
}

/** /labs — patient: to-do (pick a lab, fasting notes) and reports. */
export function PatientLabs() {
  const { data, error, loading, reload } = useLoad(() => get<LabOrderT[]>("/lab-orders"), [], 30000);
  const [cancel, setCancel] = useState<LabOrderT | null>(null);
  const todo = (data ?? []).filter((o) => o.status !== "Report ready" && o.status !== "Cancelled");
  const done = (data ?? []).filter((o) => o.status === "Report ready" || o.status === "Cancelled");
  return (
    <div>
      <PageBanner title="Lab reports" sub="Tests your doctors ordered, where to get them done, and your results." art={<LabReport />} />
      <ErrorBox e={error} />
      {loading ? <Skeleton lines={4} /> : !data?.length ? <div className="card"><IlloEmpty art={<LabTech />} title="No lab tests yet">When a doctor orders a test, it shows up here with labs near you.</IlloEmpty></div> : <>
        {todo.length > 0 && <><h2>To do</h2>{todo.map((o) => (
          <LabOrderCard key={o.id} o={o} who="patient" open actions={<>
            {o.status === "Ordered" && <LabChoice o={o} onDone={reload} />}
            {o.status === "Ordered" && <button className="danger sm" onClick={() => setCancel(o)}>Cancel order</button>}
          </>} />))}</>}
        {done.length > 0 && <><h2 className="gap">Reports</h2>{done.map((o, i) => <LabOrderCard key={o.id} o={o} who="patient" open={i === 0 && o.status === "Report ready"} />)}</>}
      </>}
      {cancel && <CancelDialog o={cancel} onClose={() => setCancel(null)} onDone={reload} />}
    </div>
  );
}

function CancelDialog({ o, onClose, onDone }: { o: LabOrderT; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [err, setErr] = useState<unknown>(null);
  const go = async () => { setErr(null); try { await post(`/lab-orders/${o.id}/cancel`, { reason }); onDone(); onClose(); } catch (x) { setErr(x); } };
  return <Modal title="Cancel this lab order?" onClose={onClose}><label>Reason (shared with the doctor and lab)</label><input value={reason} onChange={(e) => setReason(e.target.value)} /><ErrorBox e={err} /><button className="danger gap" disabled={!reason.trim()} onClick={go}>Cancel order</button></Modal>;
}

/** /labs — doctor: everything they ordered, critical first. */
export function DoctorLabs() {
  const { data, error, loading, reload } = useLoad(() => get<LabOrderT[]>("/lab-orders"), [], 30000);
  const [tab, setTab] = useState<"Pending" | "Ready" | "Abnormal" | "All">("Pending"); const [cancel, setCancel] = useState<LabOrderT | null>(null);
  const list = (data ?? []).filter((o) => tab === "All" ? true : tab === "Pending" ? !["Report ready", "Cancelled"].includes(o.status) : tab === "Ready" ? o.status === "Report ready" : !!(o.abnormal || o.critical))
    .sort((a, b) => (b.critical ?? 0) - (a.critical ?? 0));
  const count = (t: typeof tab) => (data ?? []).filter((o) => t === "Pending" ? !["Report ready", "Cancelled"].includes(o.status) : t === "Ready" ? o.status === "Report ready" : t === "Abnormal" ? !!(o.abnormal || o.critical) : true).length;
  return (
    <div>
      <PageBanner title="Lab orders" sub="Tests you ordered and their results. Critical values come first. Order new tests from a patient's record." art={<LabTech />} />
      <div className="seg">{(["Pending", "Ready", "Abnormal", "All"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t} · {count(t)}</button>)}</div>
      <ErrorBox e={error} />
      <div className="gap">{loading ? <Skeleton lines={4} /> : list.length ? list.map((o) => (
        <LabOrderCard key={o.id} o={o} who="doctor" open={!!o.critical} actions={o.status === "Ordered" ? <button className="danger sm" onClick={() => setCancel(o)}>Cancel order</button> : undefined} />))
        : <Empty>Nothing here. Open a patient from My patients to order tests.</Empty>}</div>
      {cancel && <CancelDialog o={cancel} onClose={() => setCancel(null)} onDone={reload} />}
    </div>
  );
}

/** /labs — admin / nurse: lab registry + every order. */
export function AdminLabs() {
  const labs = useLoad(() => get<LabT[]>("/labs")); const orders = useLoad(() => get<LabOrderT[]>("/lab-orders"), [], 30000);
  const [tab, setTab] = useState<"labs" | "orders">("labs"); const [adding, setAdding] = useState(false); const [err, setErr] = useState<unknown>(null);
  const toggle = async (l: LabT, k: "verified" | "active") => { setErr(null); try { await put(`/labs/${l.id}`, { [k]: !l[k] }); labs.reload(); } catch (x) { setErr(x); } };
  return (
    <div>
      <PageBanner title="Labs" sub="Diagnostic labs registered on MedSync, and every lab test ordered by doctors." art={<LabTech />} action={<button className="primary" onClick={() => setAdding(true)}>Register lab</button>} />
      <div className="seg"><button className={tab === "labs" ? "on" : ""} onClick={() => setTab("labs")}>Registered labs · {labs.data?.length ?? 0}</button><button className={tab === "orders" ? "on" : ""} onClick={() => setTab("orders")}>Lab orders · {orders.data?.length ?? 0}</button></div>
      <ErrorBox e={err ?? labs.error ?? orders.error} />
      {tab === "labs" ? <div className="card gap"><table><thead><tr><th>Lab</th><th>Tests</th><th>Home collection</th><th>Status</th><th /></tr></thead><tbody>
        {labs.data?.map((l) => <tr key={l.id}><td><b>{l.name}</b><div className="muted">{l.address} · {l.hours}</div></td><td>{l.tests.length}</td><td>{l.homeCollection ? "Yes" : "No"}</td>
          <td><Badge v={l.active ? (l.verified ? "Confirmed" : "Pending") : "Cancelled"} /> <span className="muted">{l.active ? (l.verified ? "Verified" : "Unverified") : "Inactive"}</span></td>
          <td className="actions"><button className="sm" onClick={() => toggle(l, "verified")}>{l.verified ? "Unverify" : "Verify"}</button> <button className="sm" onClick={() => toggle(l, "active")}>{l.active ? "Deactivate" : "Activate"}</button></td></tr>)}
        {labs.data && !labs.data.length && <tr><td colSpan={5} className="muted">No labs yet. Register one, or labs can sign up themselves.</td></tr>}
      </tbody></table></div>
        : <div className="gap">{orders.loading ? <Skeleton lines={4} /> : orders.data?.length ? orders.data.map((o) => <LabOrderCard key={o.id} o={o} who="both" />) : <Empty>No lab orders yet.</Empty>}</div>}
      {adding && <RegisterLab onClose={() => setAdding(false)} onDone={labs.reload} />}
    </div>
  );
}

function RegisterLab({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const tests = useLoad(() => get<LabTestT[]>("/lab-tests"));
  const [f, setF] = useState<Record<string, any>>({ tests: [] as string[], homeCollection: true }); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true); setErr(null);
    try { await post("/labs", { ...f, lat: Number(f.lat), lng: Number(f.lng), staffEmail: f.staffEmail || undefined }); onDone(); onClose(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const inp = (k: string, label: string, type = "text") => <div className="fld"><label>{label}</label><input type={type} step="any" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>;
  return (
    <Modal title="Register a lab" onClose={onClose}>
      <div className="grid2">{inp("name", "Lab name")}{inp("phone", "Phone", "tel")}<div className="fld full"><label>Address</label><input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></div>
        {inp("hours", "Opening hours")}{inp("staffEmail", "Lab staff email (optional, creates a login)", "email")}{inp("lat", "Latitude", "number")}{inp("lng", "Longitude", "number")}</div>
      <label className="check"><input type="checkbox" checked={!!f.homeCollection} onChange={(e) => set("homeCollection", e.target.checked)} /> Offers home sample collection</label>
      <label>Tests offered</label>
      <div className="chips">{(tests.data ?? []).map((t) => { const on = f.tests.includes(t.code); return <button type="button" key={t.code} className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => set("tests", on ? f.tests.filter((x: string) => x !== t.code) : [...f.tests, t.code])}>{t.name}</button>; })}</div>
      <ErrorBox e={err} /><button className="primary gap" disabled={busy} onClick={save}>{busy ? "Saving…" : "Register lab"}</button>
    </Modal>
  );
}

/** Lab staff home: orders board with status moves and result entry. */
export function LabBoard() {
  const { data, error, loading, reload } = useLoad(() => get<LabOrderT[]>("/lab-orders"), [], 20000);
  const [entering, setEntering] = useState<LabOrderT | null>(null); const [err, setErr] = useState<unknown>(null);
  const move = async (o: LabOrderT, status: string) => { setErr(null); try { await post(`/lab-orders/${o.id}/status`, { status }); reload(); } catch (x) { setErr(x); } };
  const cols: [string, string, LabOrderT[]][] = [
    ["New", "c-new", (data ?? []).filter((o) => o.status === "Ordered")],
    ["In progress", "c-act", (data ?? []).filter((o) => o.status === "Sample collected" || o.status === "Processing")],
    ["Reports sent", "c-done", (data ?? []).filter((o) => o.status === "Report ready").slice(0, 20)],
  ];
  return (
    <div>
      <PageBanner title="Lab orders" sub="Collect samples, process them, and send results. Urgent orders are listed first; critical values alert the doctor immediately." art={<LabTech />} />
      <ErrorBox e={error ?? err} />
      {loading ? <Skeleton lines={5} /> : <div className="board">{cols.map(([name, cls, list]) => (
        <section key={name} className={`col ${cls}`}><h2>{name}<span className="count">{list.length}</span></h2>
          {list.length ? list.map((o) => (
            <div key={o.id} className={`card labjob${o.priority === "Urgent" && o.status !== "Report ready" ? " urgent" : ""}`}>
              <div className="row" style={{ alignItems: "center" }}><b className="grow">{o.patientName}</b>{o.priority === "Urgent" && o.status !== "Report ready" && <span className="flag f-Critical-high">Urgent</span>}</div>
              <div>{o.tests.map((t) => t.name).join(", ")}</div>
              <div className="muted">{o.doctorName} · {fmtDateTime(o.createdAt)}{o.fasting ? " · fasting" : ""}</div>
              {o.collection && <div className="muted">{o.collection}{o.address ? `: ${o.address}` : ""}</div>}
              {o.collection === "Home collection" && o.address && <div className="maplinks"><DirectionsLink place={{ address: o.address }} label="Route to patient" /></div>}
              {o.clinicalNotes && <div className="muted">Note: {o.clinicalNotes}</div>}
              {o.status === "Report ready" && <div className="gap">{o.critical ? <span className="flag f-Critical-high">{o.critical} critical</span> : o.abnormal ? <span className="flag f-High">{o.abnormal} abnormal</span> : <span className="flag f-Normal">All in range</span>}</div>}
              <div className="row gap">
                {o.status === "Ordered" && <button className="primary sm" onClick={() => move(o, "Sample collected")}>Mark sample collected</button>}
                {o.status === "Sample collected" && <button className="sm" onClick={() => move(o, "Processing")}>Start processing</button>}
                {(o.status === "Sample collected" || o.status === "Processing") && <button className="primary sm" onClick={() => setEntering(o)}>Enter results</button>}
              </div>
            </div>)) : <p className="muted">Nothing here.</p>}
        </section>))}</div>}
      {entering && <ResultsEntry o={entering} onClose={() => setEntering(null)} onDone={reload} />}
    </div>
  );
}

function ResultsEntry({ o, onClose, onDone }: { o: LabOrderT; onClose: () => void; onDone: () => void }) {
  const cat = useLoad(() => get<LabTestT[]>("/lab-tests"));
  const tests = useMemo(() => o.tests.map((t) => cat.data?.find((c) => c.code === t.code)).filter(Boolean) as LabTestT[], [cat.data, o.tests]);
  const [vals, setVals] = useState<Record<string, { value?: string; low?: string; high?: string }>>({});
  const [note, setNote] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const set = (id: string, k: "value" | "low" | "high", v: string) => setVals((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  const submit = async () => {
    setBusy(true); setErr(null);
    const results = tests.flatMap((t) => t.analytes.map((a) => { const r = vals[`${t.code}.${a.key}`] ?? {}; return { code: t.code, key: a.key, value: r.value ?? "", low: r.low, high: r.high }; }));
    try {
      await post(`/lab-orders/${o.id}/results`, { results, note: note || undefined });
      if (file) {
        const b64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] ?? ""); fr.onerror = rej; fr.readAsDataURL(file); });
        await post(`/lab-orders/${o.id}/attachment`, { fileBase64: b64 });
      }
      onDone(); onClose();
    } catch (x) {
      setErr(x instanceof ApiError && x.details?.missing ? `${x.message}: ${x.details.missing.join("; ")}` : x);
    } finally { setBusy(false); }
  };
  return (
    <Modal title={`Results · ${o.patientName}`} onClose={onClose}>
      {cat.loading ? <Skeleton lines={5} /> : tests.map((t) => (
        <fieldset key={t.code} className="resfs"><legend>{t.name}</legend>
          {t.analytes.map((a) => {
            const id = `${t.code}.${a.key}`; const r = vals[id] ?? {};
            const low = r.low !== undefined && r.low !== "" ? Number(r.low) : a.low, high = r.high !== undefined && r.high !== "" ? Number(r.high) : a.high;
            const v = r.value !== undefined && r.value !== "" && !a.text ? Number(r.value) : NaN;
            return (
              <div key={a.key} className="resrow">
                <div className="rn"><b>{a.name}</b>{a.unit && <span className="muted"> {a.unit}</span>}</div>
                <input aria-label={`${a.name} value`} inputMode={a.text ? "text" : "decimal"} placeholder={a.text ? "e.g. Nil, Trace" : "Value"} value={r.value ?? ""} onChange={(e) => set(id, "value", e.target.value)} />
                {!a.text ? <><input aria-label="Low" className="rr" placeholder={a.low !== undefined ? String(a.low) : "low"} value={r.low ?? ""} onChange={(e) => set(id, "low", e.target.value)} /><input aria-label="High" className="rr" placeholder={a.high !== undefined ? String(a.high) : "high"} value={r.high ?? ""} onChange={(e) => set(id, "high", e.target.value)} /></> : <span /> }
                <span>{Number.isFinite(v) ? <Flag f={previewFlag(v, a, low, high)} /> : null}</span>
              </div>);
          })}
        </fieldset>))}
      <small className="muted">Reference range boxes show the default; type to use your lab&apos;s own range.</small>
      <label className="gap">Note for the doctor (optional)</label><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="gap">Report file (optional, PDF or photo)</label><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <ErrorBox e={err} />
      <button className="primary gap" disabled={busy || cat.loading} onClick={submit}>{busy ? "Sending…" : "Send report"}</button>
    </Modal>
  );
}
