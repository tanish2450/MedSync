import { useState } from "react";
import { del as _d, get, post } from "../api";
import { useAuth } from "../auth";
import { Badge, Empty, ErrorBox, Modal, fmtDateTime, fmtTime, useLoad } from "../components";
import { DoctorBook, DoctorCalendar, IlloEmpty, PageBanner } from "../illustrations";
import { Link } from "react-router-dom";

const ymd = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
void _d; void Empty;

const IST = "Asia/Kolkata";
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });
const istHour = (iso: string) => Number(new Date(iso).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: IST }));
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayLabel = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" });
/** "09:00 AM" style, always in IST. */
export const pillTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: IST });
const PARTS = [["Morning", 0, 12], ["Afternoon", 12, 17], ["Evening", 17, 24]] as const;

/** Week strip of days + Morning / Afternoon / Evening time pills. Loads one week of open slots at a time. */
export function SlotPicker({ doctorId, onPick }: { doctorId: string; onPick: (start: string) => void }) {
  const today = ymd(new Date());
  const [week, setWeek] = useState(today); const [day, setDay] = useState(""); const [sel, setSel] = useState("");
  const { data, error, loading } = useLoad(() => get<{ start: string; end: string }[]>(`/doctors/${doctorId}/slots?date=${week}&days=7`), [doctorId, week]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDay: Record<string, { start: string }[]> = {};
  for (const sl of data ?? []) (byDay[istDay(sl.start)] ??= []).push(sl);
  const active = day && days.includes(day) ? day : days.find((d) => byDay[d]?.length) ?? days[0];
  const go = (n: number) => { setWeek(addDays(week, n)); setDay(""); };
  const slots = byDay[active] ?? [];
  return (
    <div className="sp">
      <div className="sp-head"><b>{dayLabel(active, { month: "long", year: "numeric" })}</b>
        <div className="sp-nav"><button type="button" className="iconbtn" disabled={week <= today} onClick={() => go(-7)} aria-label="Previous week">‹</button><button type="button" className="iconbtn" onClick={() => go(7)} aria-label="Next week">›</button></div></div>
      <div className="sp-days" role="listbox" aria-label="Day">
        {days.map((d) => (
          <button key={d} type="button" role="option" aria-selected={d === active} className={`sp-day${d === active ? " on" : ""}${!loading && !byDay[d]?.length ? " none" : ""}`} onClick={() => setDay(d)}>
            <span className="num">{dayLabel(d, { day: "numeric" })}</span><span className="wd">{d === today ? "Today" : dayLabel(d, { weekday: "short" })}</span>
          </button>))}
      </div>
      <ErrorBox e={error} />
      {loading ? <div className="sp-times gap">{[1, 2, 3, 4].map((i) => <span key={i} className="tpill ghost" />)}</div>
        : !slots.length ? <p className="muted sp-empty">No open times on {dayLabel(active, { weekday: "long" })}. Try another day.</p>
        : PARTS.map(([name, a, b]) => {
          const list = slots.filter((x) => { const h = istHour(x.start); return h >= a && h < b; });
          return list.length ? <div key={name} className="sp-part"><div className="sp-label">{name}</div>
            <div className="sp-times">{list.map((x) => <button key={x.start} type="button" className={`tpill${sel === x.start ? " on" : ""}`} aria-pressed={sel === x.start} onClick={() => { setSel(x.start); onPick(x.start); }}>{pillTime(x.start)}</button>)}</div></div> : null;
        })}
    </div>
  );
}

export function AppointmentsPage() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useLoad(() => get<any[]>("/appointments"));
  const [resched, setResched] = useState<any | null>(null); const [slot, setSlot] = useState(""); const [err, setErr] = useState<unknown>(null);
  const conf = useLoad(() => (me?.role === "doctor" ? get<any[]>("/confirmations/mine") : Promise.resolve([] as any[])), [me?.role], 30000);
  const respond = async (id: string, response: string) => { setErr(null); try { await post(`/confirmations/${id}/respond`, { response }); conf.reload(); reload(); } catch (e) { setErr(e); } };
  const now = new Date().toISOString();
  const upcoming = (data ?? []).filter((a) => a.slotStart >= now && a.status === "Booked");
  const past = (data ?? []).filter((a) => a.slotStart < now || a.status !== "Booked").reverse();

  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); reload(); setResched(null); setSlot(""); } catch (e) { setErr(e); } };
  const Table = ({ rows, actions }: { rows: any[]; actions: boolean }) => (
    <table><thead><tr><th>When (IST)</th><th>Patient</th><th>Doctor</th><th>Status</th><th>Confirmation</th><th>Reason</th><th /></tr></thead><tbody>
      {rows.map((a) => (
        <tr key={a.id}><td>{fmtDateTime(a.slotStart)}</td>
          <td>{me?.role === "patient" ? a.patientName : <Link to={`/patient/${a.patientId}`}>{a.patientName}</Link>}</td><td>{a.doctorName}</td>
          <td><Badge v={a.status} /></td><td>{a.confirmationStatus && a.confirmationStatus !== "None" ? <Badge v={a.confirmationStatus} /> : <span className="muted">—</span>}</td><td>{a.reason ?? "—"}</td>
          <td>{actions && a.status === "Booked" && <div className="row">
            <button onClick={() => setResched(a)}>Reschedule</button>
            <button className="danger" onClick={() => confirm("Cancel this appointment?") && act(() => post(`/appointments/${a.id}/cancel`))}>Cancel</button></div>}</td></tr>
      ))}
      {!rows.length && <tr><td colSpan={7} className="muted">None</td></tr>}
    </tbody></table>
  );
  return (
    <div>
      <PageBanner title="Appointments" sub={me?.role === "patient" ? "Your upcoming visits, reschedules and history." : "Upcoming visits, confirmations and history."} art={<DoctorCalendar />} /><ErrorBox e={error ?? err} />
      {me?.role === "doctor" && (conf.data ?? []).filter((t) => t.status === "Sent" || t.status === "Pending").length > 0 && (
        <div className="card" style={{ borderColor: "var(--cta)" }}><h2>Please confirm tomorrow&apos;s appointments</h2>
          {(conf.data ?? []).filter((t) => t.status === "Sent" || t.status === "Pending").map((t) => (
            <div className="row gap" key={t.appointmentId}><div className="grow"><b>{t.patientName}</b> · {fmtDateTime(t.slotStart)}{t.reason ? ` · ${t.reason}` : ""}</div>
              <button className="primary sm" onClick={() => respond(t.appointmentId, "Confirmed")}>Confirm</button><button className="sm" onClick={() => respond(t.appointmentId, "Reschedule requested")}>Request reschedule</button></div>))}
        </div>)}
      {loading ? <p>Loading…</p> : <>
        <div className="card"><h2>Upcoming</h2>{!loading && !upcoming.length ? <IlloEmpty art={<DoctorBook />} title="No upcoming appointments">{me?.role === "patient" ? <a href="#/find">Find a doctor and book a time</a> : "New bookings will show up here."}</IlloEmpty> : <Table rows={upcoming} actions />}</div>
        <div className="card"><h2>Past &amp; cancelled</h2><Table rows={past} actions={false} /></div></>}
      {resched && (
        <Modal title={`Reschedule ${resched.patientName} with ${resched.doctorName}`} onClose={() => setResched(null)}>
          <SlotPicker doctorId={resched.doctorId} onPick={setSlot} />
          <button className="primary gap" disabled={!slot} onClick={() => act(() => post(`/appointments/${resched.id}/reschedule`, { slotStart: slot }))}>Confirm new time</button>
        </Modal>)}
    </div>
  );
}
