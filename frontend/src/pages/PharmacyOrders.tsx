import { useState } from "react";
import { get, post } from "../api";
import { ErrorBox, fmtDateTime, useLoad } from "../components";
import { PageBanner, Pharmacist } from "../illustrations";
import { Stepper } from "./Orders";
import { DirectionsLink } from "../maps";

const NEXT = (mode: string, s: string): string | null => ({ Accepted: "Packed", Packed: mode === "Delivery" ? "Out for delivery" : "Ready for pickup", "Out for delivery": "Delivered", "Ready for pickup": "Collected" } as Record<string, string>)[s] ?? null;

export function PharmacyOrders() {
  const { data, error, reload } = useLoad(() => get<any[]>("/orders"), [], 15000);
  const by = { new: data?.filter((o) => o.status === "Placed") ?? [], active: data?.filter((o) => ["Accepted", "Packed", "Out for delivery", "Ready for pickup"].includes(o.status)) ?? [], done: data?.filter((o) => ["Delivered", "Collected", "Declined", "Cancelled"].includes(o.status)) ?? [] };
  return (
    <div>
      <PageBanner title="Medicine orders" sub="New orders land on the left. Move each one along until it is delivered or collected." art={<Pharmacist />} /><ErrorBox e={error} />
      <div className="board">
        {([["new", "New", "c-new"], ["active", "In progress", "c-act"], ["done", "Completed", "c-done"]] as const).map(([t, label, cls]) => (
          <div key={t} className={`col ${cls}`}><h2>{label} <span className="count">{by[t].length}</span></h2>
            {!by[t].length && <p className="muted">Nothing here.</p>}
            {by[t].map((o) => <OrderCard key={o.id} o={o} reload={reload} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderCard({ o, reload }: { o: any; reload: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>({}); const [err, setErr] = useState<unknown>(null); const [declining, setDeclining] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const total = o.items.every((i: any) => prices[i.itemId] !== undefined && prices[i.itemId] !== "") ? o.items.reduce((t: number, i: any) => t + i.quantity * Number(prices[i.itemId]), 0) : null;
  const next = NEXT(o.mode, o.status);
  return (
    <div className="card gap">
      <div className="row" style={{ justifyContent: "space-between" }}><div><b>{o.patientName}</b> <span className="muted">· {o.mode === "Delivery" ? "Home delivery" : "Pickup"} · ordered by {o.placedByName}{o.placedByRole === "caregiver" ? " (caregiver)" : ""}</span></div><span className="muted">{fmtDateTime(o.createdAt)}</span></div>
      <div className="muted">Phone {o.phone}{o.address ? ` · ${o.address}` : ""}{o.note ? ` · Note: ${o.note}` : ""}</div>
      {o.mode === "Delivery" && o.address && <div className="maplinks"><DirectionsLink place={{ address: o.address }} label="Route to delivery address" /></div>}
      <Stepper o={o} />
      <table><thead><tr><th>Medicine</th><th>Qty</th><th>{o.status === "Placed" ? "Price per unit (₹)" : "Amount"}</th></tr></thead><tbody>
        {o.items.map((i: any) => <tr key={i.itemId}><td><b>{i.drugName}</b> <span className="muted">{i.strength} {i.form} · {i.dose}, {i.frequency}</span></td><td>{i.quantity}</td>
          <td>{o.status === "Placed" ? <input type="number" min={0} step="0.01" style={{ width: 110 }} value={prices[i.itemId] ?? ""} onChange={(e) => setPrices({ ...prices, [i.itemId]: e.target.value })} aria-label={`Price for ${i.drugName}`} /> : typeof i.unitPrice === "number" ? `₹${(i.unitPrice * i.quantity).toFixed(2)}` : "—"}</td></tr>)}</tbody></table>
      {o.status === "Placed" && total !== null && <p><b>Total ₹{total.toFixed(2)}</b></p>}
      {typeof o.total === "number" && o.status !== "Placed" && <p><b>Total ₹{o.total.toFixed(2)}</b> <span className="muted">(collect cash on {o.mode === "Delivery" ? "delivery" : "pickup"})</span></p>}
      {o.declineReason && <div className="error">Declined: {o.declineReason}</div>}
      <ErrorBox e={err} />
      {o.status === "Placed" && !declining && <div className="row gap"><button className="primary" disabled={busy || total === null} onClick={() => run(() => post(`/orders/${o.id}/accept`, { prices: o.items.map((i: any) => ({ itemId: i.itemId, unitPrice: Number(prices[i.itemId]) })) }))}>Accept order</button><button className="danger" onClick={() => setDeclining(true)}>Decline</button></div>}
      {o.status === "Placed" && declining && <div><label>Reason (the patient sees this)</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Out of stock" /><div className="row gap"><button className="danger" disabled={busy || reason.trim().length < 3} onClick={() => run(() => post(`/orders/${o.id}/decline`, { reason }))}>Decline order</button><button onClick={() => setDeclining(false)}>Back</button></div></div>}
      {next && <button className="primary" disabled={busy} onClick={() => run(() => post(`/orders/${o.id}/status`, { status: next }))}>Mark as {next.toLowerCase()}</button>}
    </div>
  );
}
