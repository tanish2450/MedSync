import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../brand";
import { Avatar, Empty, ErrorBox, Modal, Skeleton, fmtDateTime, fmtTime, useLoad } from "../components";
import { DoctorChat } from "../illustrations";

export interface EmergencyT { active: boolean; since?: string; note?: string }
interface ThreadT {
  id: string; patientId: string; patientName: string; staffKey: string; staffName: string; staffRole: string;
  emergency: boolean; lastAt: string; lastText: string; lastSenderRole: string; unread: number;
}
interface MsgT { id: string; senderId: string; senderName: string; senderRole: string; text: string; emergency: boolean; kind: "text" | "system"; createdAt: string }

const ago = (iso: string) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? fmtTime(iso) : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/** Patient ↔ doctor and patient ↔ nursing-desk messaging. Emergency conversations always sit above regular ones. */
export function MessagesPage() {
  const { me } = useAuth(); const isPatient = me!.role === "patient";
  const [sp, setSp] = useSearchParams(); const open = sp.get("t");
  const list = useLoad(() => get<{ threads: ThreadT[]; emergency?: EmergencyT }>("/chats"), [], 8000);
  const [starting, setStarting] = useState(false);
  // one row per person even if the API ever returns more than one conversation with them
  const threads = (list.data?.threads ?? []).filter((t, i, all) => all.findIndex((o) => (isPatient ? o.staffKey === t.staffKey : o.patientId === t.patientId)) === i);
  const urgent = threads.filter((t) => t.emergency); const regular = threads.filter((t) => !t.emergency);
  const select = (id: string | null) => setSp(id ? { t: id } : {}, { replace: !id });
  const title = (t: ThreadT) => (isPatient ? t.staffName : t.patientName);

  const row = (t: ThreadT) => (
    <button key={t.id} className={`thread${t.id === open ? " on" : ""}${t.emergency ? " sos" : ""}`} onClick={() => select(t.id)}>
      <Avatar name={title(t)} small />
      <span className="tmain">
        <span className="trow"><b>{title(t)}</b><small>{ago(t.lastAt)}</small></span>
        <span className="trow"><span className="tlast">{t.lastText || (isPatient ? (t.staffRole === "doctor" ? "Your doctor" : "Nurses on duty") : "No messages yet")}</span>
          {t.unread > 0 && <span className="unread">{t.unread}</span>}</span>
      </span>
    </button>
  );

  return (
    <div>
      <div className="row"><h1 className="grow">Messages</h1>
        {!isPatient && <button className="primary" onClick={() => setStarting(true)}><Icon n="chat" />New conversation</button>}</div>
      <div className={`chat${open ? " has-open" : ""}`}>
        <aside className="threads" aria-label="Conversations">
          {list.loading ? <div style={{ padding: 16 }}><Skeleton lines={5} /></div> : list.error ? <div style={{ padding: 12 }}><ErrorBox e={list.error} /></div> : !threads.length ? <Empty>No conversations yet.</Empty> : <>
            {urgent.length > 0 && <><div className="tgroup sos">Emergency · {urgent.length}</div>{urgent.map(row)}</>}
            {regular.length > 0 && <>{urgent.length > 0 && <div className="tgroup">Conversations</div>}{regular.map(row)}</>}
          </>}
        </aside>
        <section className="convo">
          {open ? <Conversation key={open} id={open} onBack={() => select(null)} onSent={list.reload} /> : <div className="convo-empty"><DoctorChat /><b>Select a conversation</b><span className="muted">{isPatient ? "Message your doctor or the nursing desk." : "Emergency conversations are always listed first."}</span></div>}
        </section>
      </div>
      {starting && <StartConversation onClose={() => setStarting(false)} onStart={(id) => { setStarting(false); select(id); list.reload(); }} />}
    </div>
  );
}

function Conversation({ id, onBack, onSent }: { id: string; onBack: () => void; onSent: () => void }) {
  const { me } = useAuth(); const isPatient = me!.role === "patient";
  const { data, error, loading, reload } = useLoad(() => get<{ thread: ThreadT; emergency: EmergencyT; messages: MsgT[] }>(`/chats/${encodeURIComponent(id)}/messages`), [id], 4000);
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null); const count = data?.messages.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ behavior: count > 0 ? "smooth" : "auto", block: "end" }); }, [count]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setErr(null);
    try { await post(`/chats/${encodeURIComponent(id)}/messages`, { text }); setText(""); reload(); onSent(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const resolve = async () => { setErr(null); try { await post(`/emergency/${encodeURIComponent(data!.thread.patientId)}/resolve`); reload(); onSent(); } catch (x) { setErr(x); } };

  if (loading) return <div style={{ padding: 20 }}><Skeleton lines={6} /></div>;
  if (error) return <div style={{ padding: 20 }}><ErrorBox e={error} /></div>;
  const t = data!.thread; const sos = data!.emergency.active; const name = isPatient ? t.staffName : t.patientName;
  return (
    <>
      <header className="convo-head">
        <button className="iconbtn back" onClick={onBack} aria-label="Back to conversations"><span aria-hidden>←</span></button>
        <Avatar name={name} small />
        <div className="grow"><b>{name}</b><div className="muted">{isPatient ? (t.staffRole === "doctor" ? "Doctor" : "Nurses on duty") : "Patient"}</div></div>
        {!isPatient && <Link to={`/patient/${t.patientId}`}><button className="sm">Open record</button></Link>}
      </header>
      {sos && <div className="sosbar" role="alert"><span className="sosdot" /><div className="grow"><b>Emergency active</b> since {fmtTime(data!.emergency.since!)}{data!.emergency.note ? ` · “${data!.emergency.note}”` : ""}</div>
        {!isPatient && <button className="sm" onClick={resolve}>Mark resolved</button>}</div>}
      <div className="msgs" aria-live="polite">
        {!data!.messages.length && <div className="convo-empty small"><span className="muted">No messages yet. Say hello{isPatient ? " or describe what you need" : " and follow up with the patient"}.</span></div>}
        {data!.messages.map((m) => m.kind === "system"
          ? <div key={m.id} className={`sysmsg${m.text.startsWith("🚨") ? " sos" : ""}`}>{m.text}<small>{fmtDateTime(m.createdAt)}</small></div>
          : <div key={m.id} className={`bubble${m.senderId === me!.sub ? " mine" : ""}${m.emergency ? " sos" : ""}`}>
              {m.senderId !== me!.sub && t.staffKey === "nurses" && <small className="who">{m.senderName}</small>}
              <div>{m.text}</div><small>{m.emergency && "Emergency · "}{fmtTime(m.createdAt)}</small>
            </div>)}
        <div ref={end} />
      </div>
      <ErrorBox e={err} />
      <form className="composer" onSubmit={send}>
        <textarea rows={1} value={text} maxLength={2000} placeholder={sos && isPatient ? "Describe your emergency…" : "Write a message…"} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message" />
        <button className="primary" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send"}</button>
      </form>
    </>
  );
}

/** Doctor / nurse: opens (or resumes) the conversation with this patient. */
export function MessagePatientButton({ patientId, small, label = "Message patient" }: { patientId: string; small?: boolean; label?: string }) {
  const nav = useNavigate(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const { id } = await post<{ id: string }>("/chats/start", { patientId }); nav(`/messages?t=${encodeURIComponent(id)}`); } catch (x) { setErr(x); setBusy(false); }
  };
  return <>{<button type="button" className={`primary${small ? " sm" : ""}`} disabled={busy} onClick={go}><Icon n="chat" />{busy ? "Opening…" : label}</button>}{!!err && <ErrorBox e={err} />}</>;
}

function StartConversation({ onClose, onStart }: { onClose: () => void; onStart: (id: string) => void }) {
  const pts = useLoad(() => get<any[]>("/patients"));
  const [pid, setPid] = useState(""); const [err, setErr] = useState<unknown>(null);
  const go = async () => { setErr(null); try { onStart((await post<{ id: string }>("/chats/start", { patientId: pid })).id); } catch (x) { setErr(x); } };
  return (
    <Modal title="New conversation" onClose={onClose}>
      <label>Patient</label>
      {pts.loading ? <Skeleton lines={1} /> : <select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose a patient…</option>{(pts.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.emergency?.active ? " (emergency)" : ""}</option>)}</select>}
      <ErrorBox e={err || pts.error} />
      <button className="primary gap" disabled={!pid} onClick={go}>Open conversation</button>
    </Modal>
  );
}

/** Patient dashboard switch: raises an emergency that alerts every assigned doctor, the nursing desk and caregivers. */
export function EmergencyToggle() {
  const { data, reload } = useLoad(() => get<EmergencyT>("/emergency"), [], 15000);
  const [confirm, setConfirm] = useState<null | "on" | "off">(null); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const on = !!data?.active;
  const apply = async (active: boolean) => {
    setBusy(true); setErr(null);
    try { await post("/emergency", active ? { active, ...(note.trim() ? { note } : {}) } : { active }); setConfirm(null); setNote(""); reload(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <section className={`sos-card${on ? " on" : ""}`} aria-live="polite">
      <div className="sos-icon"><Icon n="alert" /></div>
      <div className="grow">
        <b>{on ? "Emergency mode is ON" : "Emergency mode"}</b>
        <div className="muted">{on ? `Since ${fmtTime(data!.since!)}. Your doctors and the nursing desk were alerted and see you first.` : "Need urgent help? Switch this on to alert your doctors and nurses immediately."}</div>
        {on && <Link to="/messages" className="sos-link">Message your care team →</Link>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label="Emergency mode" className={`switch${on ? " on" : ""}`} disabled={!data || busy} onClick={() => setConfirm(on ? "off" : "on")}><span /></button>
      {confirm === "on" && <Modal title="Alert your care team?" onClose={() => setConfirm(null)}>
        <p>Your assigned doctors, the nursing desk and your caregivers get an immediate alert, and your messages move to the top of their inbox.</p>
        <p className="muted">If your life is in danger, call <b>112</b> right away.</p>
        <label>What is happening? (optional)</label>
        <textarea rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. chest pain and dizziness since 10 minutes" />
        <ErrorBox e={err} />
        <button className="primary danger-fill gap" disabled={busy} onClick={() => apply(true)}>{busy ? "Alerting…" : "Turn on emergency mode"}</button>
      </Modal>}
      {confirm === "off" && <Modal title="Turn off emergency mode?" onClose={() => setConfirm(null)}>
        <p>Your care team will be told the emergency is over.</p><ErrorBox e={err} />
        <button className="primary gap" disabled={busy} onClick={() => apply(false)}>{busy ? "Updating…" : "Yes, I'm okay now"}</button>
      </Modal>}
    </section>
  );
}
