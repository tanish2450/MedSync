import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, get, post } from "./api";

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
export const initials = (n: string) => n.replace(/^Dr\.?\s*/i, "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export const Avatar = ({ name, small }: { name: string; small?: boolean }) => <div className={`avatar${small ? " sm" : ""}`} aria-hidden>{initials(name)}</div>;
export const Badge = ({ v }: { v: string }) => <span className={`badge b-${v.replace(/\s/g, "-")}`}>{v}</span>;
export const ErrorBox = ({ e }: { e: unknown }) => (e ? <div className="error" role="alert">{e instanceof ApiError ? e.message : String((e as Error)?.message ?? e)}</div> : null);
export const Skeleton = ({ lines = 3 }: { lines?: number }) => <div aria-busy="true">{Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />)}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2 className="grow">{title}</h2><button className="sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

/** Loads data with loading/error states; `reload` refreshes after mutations; `pollMs` keeps live views fresh (AppSync arrives later). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true; if (tick === 0) setLoading(true);
    fn().then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => live && setError(e)).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => { if (!pollMs) return; const id = setInterval(() => setTick((t) => t + 1), pollMs); return () => clearInterval(id); }, [pollMs]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export interface AlertT {
  key: string; type: string; severity: string; drugs: string[]; title: string; mechanism?: string; effect?: string;
  recommendation?: string; source?: string; requiresAck: boolean; explanation?: { doctor: string; patient: string } | null;
}
/** Renders safety alerts straight from stored records. AI text, when present, is labelled and secondary. */
export function AlertList({ alerts, acks, setAck }: { alerts: AlertT[]; acks?: Record<string, string>; setAck?: (key: string, reason: string) => void }) {
  if (!alerts.length) return <div className="success">No known interaction found in our database. This is not a guarantee of safety.</div>;
  return (
    <div>
      {alerts.map((a) => (
        <div key={a.key} className={`alert ${a.severity}`}>
          <div className="sev">{a.severity}{a.type === "allergy" ? " allergy" : a.type === "interaction" ? " interaction" : " duplicate therapy"}</div>
          <strong>{a.title}</strong>
          {a.effect && <div><b>Effect:</b> {a.effect}</div>}
          {a.mechanism && <div className="muted"><b>Why:</b> {a.mechanism}</div>}
          {a.recommendation && <div><b>Recommended action:</b> {a.recommendation}</div>}
          {a.explanation && <div className="muted gap"><i>Plain-language rewrite (AI-generated from the record above; stored fields are authoritative):</i> {a.explanation.doctor}</div>}
          {a.source && <div className="muted">Source: {a.source}</div>}
          {a.requiresAck && setAck && (
            <div className="gap"><label>Acknowledge / override reason (logged; required to finalise)</label>
              <input value={acks?.[a.key] ?? ""} onChange={(e) => setAck(a.key, e.target.value)} placeholder="e.g. Benefit outweighs risk; INR monitoring arranged" /></div>
          )}
        </div>
      ))}
      <div className="disclaimer">MedSync supports, and does not replace, clinical judgement.</div>
    </div>
  );
}

/** Notification bell: real notifications from the API, polled every 20 s. */
export function NotificationBell() {
  const { data, reload } = useLoad(() => get<{ unread: number; items: any[] }>("/notifications"), [], 20000);
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", c); return () => document.removeEventListener("mousedown", c); }, []);
  const toggle = async () => { const next = !open; setOpen(next); if (next && data?.unread) { await post("/notifications/read-all"); setTimeout(reload, 1500); } };
  return (
    <div className="bellwrap" ref={ref}>
      <button className="bell" onClick={toggle} aria-label={`Notifications, ${data?.unread ?? 0} unread`} aria-expanded={open}>🔔{!!data?.unread && <span className="dot">{data.unread}</span>}</button>
      {open && <div className="drop" role="menu">
        {!data?.items.length ? <Empty>No notifications yet</Empty> : data.items.map((n) => (
          <div key={n.id} className={`n ${n.readAt ? "" : "unread"}`} style={n.payload?.link ? { cursor: "pointer" } : undefined} onClick={() => { if (n.payload?.link) { setOpen(false); window.location.hash = `#${n.payload.link}`; } }}><b>{n.title}</b><div>{n.body}</div><div className="muted">{fmtDateTime(n.createdAt)} · {Object.entries(n.deliveryStatus ?? {}).map(([c, s]) => `${c}: ${s}`).join(", ")}</div></div>
        ))}
      </div>}
    </div>
  );
}

const Ring = ({ percent }: { percent: number | null }) => <div className={`ring${percent !== null && percent < 70 ? " low" : ""}`} style={{ ["--p" as any]: percent ?? 0 }} aria-label={`Adherence ${percent ?? "not available"}%`}><div>{percent === null ? "—" : `${percent}%`}</div></div>;

/** Today's dose checklist with one-click Taken / Skip (patient, or caregiver with permission). */
export function DoseChecklist({ patientId, canMark }: { patientId: string; canMark: boolean }) {
  const { data, error, loading, reload } = useLoad(() => get<{ date: string; doses: any[] }>(`/patients/${patientId}/doses`), [patientId], 30000);
  const [err, setErr] = useState<unknown>(null); const [skip, setSkip] = useState<any>(null); const [reason, setReason] = useState("");
  const mark = async (d: any, status: "Taken" | "Skipped", why?: string) => { setErr(null); try { await post(`/patients/${patientId}/doses/mark`, { doseKey: d.doseKey, status, reason: why }); setSkip(null); setReason(""); reload(); } catch (e) { setErr(e); } };
  if (loading) return <Skeleton lines={3} />;
  if (error) return <ErrorBox e={error} />;
  const doses = data?.doses ?? [];
  const missed = doses.filter((d) => d.status === "Missed").length; const taken = doses.filter((d) => d.status === "Taken").length;
  return (
    <div>
      <div className="muted">{taken} of {doses.length} taken today{missed ? ` · ${missed} missed` : ""}</div>
      <ErrorBox e={err} />
      {!doses.length && <Empty>No doses scheduled today.</Empty>}
      {doses.map((d) => (
        <div key={d.doseKey} className={`dose ${d.status}`}>
          <div className="t">{fmtTime(d.scheduledTime)}</div>
          <div className="grow"><b>{d.drugName}</b> <span className="muted">{d.strength} · {d.dose}{d.instructions ? ` · ${d.instructions}` : ""}</span>
            {d.status === "Missed" && <div className="muted">Missed. Check your medicine instructions or ask your doctor what to do next.</div>}</div>
          {d.status === "Scheduled" && canMark ? <div className="row"><button className="primary sm" onClick={() => mark(d, "Taken")}>Taken</button><button className="sm" onClick={() => setSkip(d)}>Skip</button></div> : <Badge v={d.status} />}
        </div>
      ))}
      {skip && <Modal title={`Skip ${skip.drugName}?`} onClose={() => setSkip(null)}><label>Reason (kept in your history)</label><input value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="primary gap" disabled={!reason.trim()} onClick={() => mark(skip, "Skipped", reason)}>Skip this dose</button></Modal>}
    </div>
  );
}

/** Adherence %, streak, per-medicine bars and part-of-day heat map. */
export function AdherencePanel({ patientId, days = 7 }: { patientId: string; days?: number }) {
  const { data, error, loading } = useLoad(() => get<any>(`/patients/${patientId}/adherence?days=${days}`), [patientId, days]);
  if (loading) return <Skeleton />; if (error) return <ErrorBox e={error} />; if (!data) return null;
  const cls = (b: { taken: number; due: number }) => (!b.due ? "" : b.taken / b.due >= 0.85 ? "h3" : b.taken / b.due >= 0.6 ? "h2" : "h1");
  return (
    <div>
      <div className="row"><Ring percent={data.percent} /><div><div className="stat">{data.streakDays}<span className="muted"> day streak</span></div>
        <div className="muted">{data.taken} taken · {data.missed} missed · {data.skipped} skipped (last {days} days)</div></div></div>
      {data.perMedicine.length > 0 && <table className="gap"><tbody>{data.perMedicine.map((m: any) => <tr key={m.drugId}><td>{m.drugName}</td><td>{m.percent === null ? "—" : `${m.percent}%`}</td><td className="muted">{m.taken}/{m.due} doses</td></tr>)}</tbody></table>}
      <div className="muted gap">When doses get missed</div>
      <div className="heat">{(["morning", "afternoon", "evening", "night"] as const).map((p) => <div key={p} className={cls(data.byPartOfDay[p])}>{p}<br />{data.byPartOfDay[p].due ? `${Math.round((data.byPartOfDay[p].taken / data.byPartOfDay[p].due) * 100)}%` : "—"}</div>)}</div>
    </div>
  );
}

export interface DocT { id: string; name: string; specialty: string; fee: number; languages: string[]; clinic: { name: string; address: string }; onlineStatus: string; qualifications?: string; consultationHours?: string; nextSlots?: { start: string; end: string }[] }
/** ZocDoc-style card: identity, status pill, and a row of next-available slot buttons you can click to book. */
export function DoctorCard({ d, onSlot, onOpen }: { d: DocT; onSlot: (start: string) => void; onOpen: () => void }) {
  return (
    <article className="doc">
      <Avatar name={d.name} />
      <div>
        <div className="row"><a className="name" href="#" onClick={(e) => { e.preventDefault(); onOpen(); }}>{d.name}</a><span className={`pill ${d.onlineStatus}`}>{d.onlineStatus === "Available" ? "Available now" : d.onlineStatus}</span></div>
        <div className="meta"><b>{d.specialty}</b>{d.qualifications ? ` · ${d.qualifications}` : ""}</div>
        <div className="meta">{d.clinic?.name} · {d.clinic?.address}</div>
        <div className="muted">₹{d.fee} consultation · {d.languages?.join(", ")}</div>
      </div>
      <div className="slotsrow">
        {d.nextSlots?.length ? <><div className="muted" style={{ marginBottom: 6 }}>Next available</div><div className="slots">
          {d.nextSlots.map((s) => <button key={s.start} className="slot" onClick={() => onSlot(s.start)}>{fmtTime(s.start)}<small>{fmtDay(s.start)}</small></button>)}
          <button className="slot" onClick={onOpen}>More times</button></div></> : <span className="muted">No open slots in the next 7 days. <a href="#" onClick={(e) => { e.preventDefault(); onOpen(); }}>See profile</a></span>}
      </div>
    </article>
  );
}

export function downloadIcs(a: { title: string; start: string; end: string; location?: string }) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MedSync//EN", "BEGIN:VEVENT", `UID:${a.start}@medsync`, `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(a.start)}`, `DTEND:${f(a.end)}`,
    `SUMMARY:${a.title}`, a.location ? `LOCATION:${a.location}` : "", "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Appointment reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); const el = document.createElement("a"); el.href = url; el.download = "appointment.ics"; el.click(); URL.revokeObjectURL(url);
}
