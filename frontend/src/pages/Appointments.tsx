import { useState } from "react";
import { del as _d, get, post } from "../api";
import { useAuth } from "../auth";
import { Badge, Empty, ErrorBox, Modal, fmtDateTime, fmtTime, useLoad } from "../components";
import { DoctorBook, IlloEmpty } from "../illustrations";
import { Link } from "react-router-dom";

const ymd = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
void _d; void Empty;

export function SlotPicker({ doctorId, onPick, days = 1 }: { doctorId: string; onPick: (start: string) => void; days?: number }) {
  const [date, setDate] = useState(ymd(new Date(Date.now() + 86400_000)));
  const [sel, setSel] = useState("");
  const { data, error, loading } = useLoad(() => get<{ start: string; end: string }[]>(`/doctors/${doctorId}/slots?date=${date}&days=${days}`), [doctorId, date]);
  return (
    <div>
      <div className="field"><label>Date</label><input type="date" value={date} min={ymd(new Date())} onChange={(e) => { setDate(e.target.value); setSel(""); }} /></div>
      <ErrorBox e={error} />
      <div className="slots gap">
        {loading ? <span className="muted">Loading slots…</span> : data?.length ? data.map((s) => (
          <button key={s.start} className={`slot${sel === s.start ? " sel" : ""}`} onClick={() => { setSel(s.start); onPick(s.start); }}>{fmtTime(s.start)}</button>
        )) : <span className="muted">No open slots on this date.</span>}
      </div>
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
      <h1>Appointments</h1><ErrorBox e={error ?? err} />
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
