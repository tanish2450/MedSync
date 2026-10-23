import { useEffect, useState } from "react";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { Badge, ErrorBox, fmtDate, fmtDateTime, useLoad } from "../components";

const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const STEPS = (mode: string) => ["Placed", "Accepted", "Packed", mode === "Delivery" ? "Out for delivery" : "Ready for pickup", mode === "Delivery" ? "Delivered" : "Collected"];
export const Stepper = ({ o }: { o: any }) => {
  if (o.status === "Declined" || o.status === "Cancelled") return <Badge v={o.status === "Declined" ? "Missed" : "Skipped"} />;
  const steps = STEPS(o.mode); const at = steps.indexOf(o.status);
  return <ol className="stepper">{steps.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : ""}>{s}</li>)}</ol>;
};

export function OrdersPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<"new" | "mine">("new");
  return (
    <div className="narrow">
      <h1>Order medicines</h1>
      <div className="chips"><button className={`chip${tab === "new" ? " on" : ""}`} onClick={() => setTab("new")}>New order</button><button className={`chip${tab === "mine" ? " on" : ""}`} onClick={() => setTab("mine")}>{me?.role === "caregiver" ? "Orders" : "My orders"}</button></div>
      {tab === "new" ? <NewOrder onPlaced={() => setTab("mine")} /> : <MyOrders />}
    </div>
  );
}

function NewOrder({ onPlaced }: { onPlaced: () => void }) {
  const { me } = useAuth();
  const pts = useLoad(() => (me?.role === "caregiver" ? get<any[]>("/patients") : Promise.resolve([] as any[])), [me?.role]);
  const [sel, setSel] = useState("");
  const patientId = me?.role === "patient" ? me.sub : sel || pts.data?.[0]?.id || "";
  const opt = useLoad(() => (patientId ? get<any>(`/patients/${patientId}/orderable`) : Promise.resolve(null)), [patientId]);
  const pharm = useLoad(() => get<any[]>("/pharmacies"));
  const [qty, setQty] = useState<Record<string, number>>({}); const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [pharmacyId, setPharmacyId] = useState(""); const [mode, setMode] = useState<"Delivery" | "Pickup">("Delivery");
  const [address, setAddress] = useState(""); const [phone, setPhone] = useState(""); const [note, setNote] = useState("");
  const [here, setHere] = useState<[number, number] | null>(null); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [geoMsg, setGeoMsg] = useState("");

  useEffect(() => {
    if (!opt.data) return;
    const q: Record<string, number> = {}, c: Record<string, boolean> = {};
    opt.data.medicines.forEach((m: any) => { q[m.itemId] = m.suggestedQuantity; c[m.itemId] = true; });
    setQty(q); setChosen(c); setAddress(opt.data.address ?? ""); setPhone(opt.data.phone ?? "");
  }, [opt.data]);

  const locate = () => { setGeoMsg("Finding you…"); navigator.geolocation?.getCurrentPosition((p) => { setHere([p.coords.latitude, p.coords.longitude]); setGeoMsg(""); }, () => setGeoMsg("Could not get your location."), { timeout: 10000 }); };
  const list = (pharm.data ?? []).filter((p) => p.active !== false).map((p) => ({ ...p, dist: here && typeof p.lat === "number" ? km(here, [p.lat, p.lng]) : null }))
    .sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9) || a.name.localeCompare(b.name));
  const lines = (opt.data?.medicines ?? []).filter((m: any) => chosen[m.itemId]).map((m: any) => ({ itemId: m.itemId, quantity: Number(qty[m.itemId]) }));
  const place = async () => {
    setBusy(true); setErr(null);
    try { await post("/orders", { patientId, pharmacyId, items: lines, mode, address, phone, note }); onPlaced(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <ErrorBox e={pts.error ?? opt.error ?? pharm.error} />
      {me?.role === "caregiver" && <div className="card gap"><div className="fld"><label>Ordering for</label><select value={patientId} onChange={(e) => setSel(e.target.value)}>{pts.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>{pts.data && !pts.data.length && <p className="muted">You are not linked to any patient yet.</p>}</div>}

      <div className="card gap"><h2>1. Medicines</h2>
        {opt.data?.medicines.length ? opt.data.medicines.map((m: any) => (
          <div className="row gap" key={m.itemId} style={{ alignItems: "center" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={!!chosen[m.itemId]} onChange={(e) => setChosen({ ...chosen, [m.itemId]: e.target.checked })} aria-label={`Order ${m.drugName}`} />
            <div className="grow"><b>{m.drugName}</b> <span className="muted">{m.strength} {m.form}</span><div className="muted">{m.dose}, {m.frequency} · until {fmtDate(m.endDate)} · {m.doctorName}</div></div>
            <div className="fld" style={{ width: 110 }}><label>{/(tablet|capsule)/i.test(m.form) ? "Quantity" : "Packs"}</label><input type="number" min={1} max={500} value={qty[m.itemId] ?? 1} disabled={!chosen[m.itemId]} onChange={(e) => setQty({ ...qty, [m.itemId]: Number(e.target.value) })} /></div>
          </div>)) : <p className="muted">{opt.data ? "No active prescribed medicines to order. Ask the doctor to prescribe, or upload a prescription." : "Loading…"}</p>}
        {!!opt.data?.medicines.length && <small className="muted">Quantities are suggested from the dose and the days left on each prescription. Change them if needed.</small>}</div>

      <div className="card gap"><div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h2 style={{ margin: 0 }}>2. Pharmacy</h2><button className="sm" onClick={locate}>Sort by nearest</button></div>{geoMsg && <small className="muted">{geoMsg}</small>}
        {list.map((p) => (
          <label key={p.id} className={`pick${pharmacyId === p.id ? " on" : ""}`}>
            <input type="radio" name="pharmacy" checked={pharmacyId === p.id} onChange={() => setPharmacyId(p.id)} />
            <div className="grow"><b>{p.name}</b> {p.verified === false ? <span className="muted">· Unverified</span> : null}<div className="muted">{p.address}{p.hours ? ` · Open ${p.hours}` : ""}{p.phone ? ` · ${p.phone}` : ""}</div></div>
            {p.dist !== null && <span className="muted">{p.dist.toFixed(1)} km</span>}
          </label>))}
        {pharm.data && !list.length && <p className="muted">No pharmacies are available yet.</p>}</div>

      <div className="card gap"><h2>3. Delivery</h2>
        <div className="chips"><button type="button" className={`chip${mode === "Delivery" ? " on" : ""}`} onClick={() => setMode("Delivery")}>Home delivery</button><button type="button" className={`chip${mode === "Pickup" ? " on" : ""}`} onClick={() => setMode("Pickup")}>I will pick it up</button></div>
        <div className="grid2 gap">
          {mode === "Delivery" && <div className="fld full"><label>Delivery address</label><textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>}
          <div className="fld"><label>Contact number</label><input type="tel" value={phone} placeholder="+919876543210" onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="fld"><label>Note (optional)</label><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></div></div>
        <p className="muted">Payment is made directly to the pharmacy when you receive or collect the medicines. The pharmacy confirms the price when it accepts your order.</p>
        <ErrorBox e={err} />
        <button className="primary" disabled={busy || !lines.length || !pharmacyId || lines.some((l: any) => !(l.quantity >= 1))} onClick={place}>{busy ? "Placing…" : `Place order (${lines.length} medicine${lines.length === 1 ? "" : "s"})`}</button></div>
    </div>
  );
}

function MyOrders() {
  const { data, error, reload } = useLoad(() => get<any[]>("/orders"), [], 15000); const [err, setErr] = useState<unknown>(null);
  const cancel = async (id: string) => { setErr(null); try { await post(`/orders/${id}/cancel`); reload(); } catch (e) { setErr(e); } };
  return (
    <div className="gap"><ErrorBox e={error ?? err} />
      {data && !data.length && <div className="card"><p className="muted">No orders yet.</p></div>}
      {data?.map((o) => (
        <div className="card" key={o.id}>
          <div className="row" style={{ justifyContent: "space-between" }}><div><b>{o.pharmacyName}</b> <span className="muted">· {o.patientName} · {o.mode === "Delivery" ? "Home delivery" : "Pickup"}</span></div><span className="muted">{fmtDateTime(o.createdAt)}</span></div>
          <Stepper o={o} />
          <table><tbody>{o.items.map((i: any) => <tr key={i.itemId}><td><b>{i.drugName}</b> <span className="muted">{i.strength} {i.form}</span></td><td>× {i.quantity}</td><td>{typeof i.unitPrice === "number" ? `₹${(i.unitPrice * i.quantity).toFixed(2)}` : <span className="muted">price pending</span>}</td></tr>)}</tbody></table>
          {typeof o.total === "number" && <p><b>Total ₹{o.total.toFixed(2)}</b> <span className="muted">· pay on {o.mode === "Delivery" ? "delivery" : "pickup"}</span></p>}
          {o.declineReason && <div className="error">Declined: {o.declineReason}</div>}
          {(o.status === "Placed" || o.status === "Accepted") && <button className="danger sm" onClick={() => confirm("Cancel this order?") && cancel(o.id)}>Cancel order</button>}
        </div>))}
    </div>
  );
}
