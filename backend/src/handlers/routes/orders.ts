import { randomUUID } from "node:crypto";
import type { Route } from "../router.js";
import { badRequest, forbidden, HttpError, notFound, type Caller } from "../../lib/http.js";
import { getItem, putItem, query, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { assertCanViewPatient, loadActiveMeds, loadPatient, nowIso, today } from "../../lib/services.js";
import { OPEN_STATUSES, canCancel, orderTotal, pharmacyNext, suggestQuantity, validateLines, type OrderMode, type OrderStatus } from "../../domain/orders.js";
import { reminderTimes } from "../../domain/doses.js";

interface OrderItem { itemId: string; drugId: string; drugName: string; strength: string; form: string; dose: string; frequency: string; quantity: number; unitPrice?: number | null }
export interface Order {
  id: string; patientId: string; patientName: string; placedBy: string; placedByName: string; placedByRole: string;
  pharmacyId: string; pharmacyName: string; items: OrderItem[]; mode: OrderMode; address?: string; phone: string; note?: string;
  status: OrderStatus; total: number | null; history: { status: OrderStatus; at: string; by: string }[]; declineReason?: string; createdAt: string; updatedAt: string;
}
const PHONE = /^\+[1-9]\d{7,14}$/;

async function pharmacyOf(caller: Caller): Promise<string> {
  const u = await getItem<{ pharmacyId?: string }>("Users", { id: caller.sub });
  if (!u?.pharmacyId) throw forbidden("Your account is not linked to a pharmacy");
  return u.pharmacyId;
}
async function loadOrder(id: string): Promise<Order> { const o = await getItem<Order>("Orders", { id }); if (!o) throw notFound("Order not found"); return o; }

/** Patient, the caregiver who placed/is linked, or the pharmacy that received it. */
async function assertParty(caller: Caller, o: Order) {
  if (caller.role === "pharmacy") { if ((await pharmacyOf(caller)) !== o.pharmacyId) throw forbidden(); return; }
  await assertCanViewPatient(caller, await loadPatient(o.patientId));
}
async function ordersFor(caller: Caller): Promise<Order[]> {
  if (caller.role === "pharmacy") return query<Order>("Orders", { index: "byPharmacy", pk: "pharmacyId", pkValue: await pharmacyOf(caller), forward: false });
  if (caller.role === "patient") return query<Order>("Orders", { index: "byPatient", pk: "patientId", pkValue: caller.sub, forward: false });
  const links = await query<{ patientId: string; status: string }>("CaregiverLinks", { index: "byCaregiver", pk: "caregiverId", pkValue: caller.sub });
  const lists = await Promise.all(links.filter((l) => l.status === "Active").map((l) => query<Order>("Orders", { index: "byPatient", pk: "patientId", pkValue: l.patientId, forward: false })));
  return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function move(o: Order, to: OrderStatus, caller: Caller, extra: Record<string, unknown> = {}) {
  const at = nowIso();
  try {
    await updateItem("Orders", { id: o.id }, { status: to, updatedAt: at, history: [...o.history, { status: to, at, by: caller.name }], ...extra }, { expr: "#st = :cur", names: { "#st": "status" }, values: { ":cur": o.status } });
  } catch (e: any) { if (e?.name === "ConditionalCheckFailedException") throw new HttpError(409, "This order was just updated. Refresh and try again"); throw e; }
  await audit({ actor: caller.sub, actorRole: caller.role, action: `order.${to.toLowerCase().replace(/ /g, "-")}`, entity: `patient#${o.patientId}`, after: { orderId: o.id, status: to } });
}
async function tell(o: Order, title: string, body: string, key: string) {
  const people = new Set([o.patientId, o.placedBy]);
  await Promise.all([...people].map((u) => notify({ userId: u, type: "order", title, body, payload: { link: "/orders" }, dedupeKey: `${key}-${u}` }).catch(() => undefined)));
}

export const orderRoutes: Route[] = [
  {
    // Medicines a patient can order = their currently prescribed ones, with a suggested pack size
    method: "GET", path: "/patients/:id/orderable", roles: ["patient", "caregiver"],
    async handler({ caller, params }) {
      const patient = await loadPatient(params.id); await assertCanViewPatient(caller, patient);
      const t = today();
      return {
        address: patient.address ?? "", phone: patient.phone ?? "",
        medicines: (await loadActiveMeds(patient.id)).map((m) => ({
          itemId: m.itemId, drugName: m.drugName, strength: m.strength, form: m.form, dose: m.dose, frequency: m.frequency, endDate: m.endDate, doctorName: m.doctorName,
          reminderTimes: reminderTimes(m.frequency, m.timings), suggestedQuantity: suggestQuantity(m, t),
        })),
      };
    },
  },
  {
    method: "POST", path: "/orders", roles: ["patient", "caregiver"], status: 201,
    async handler({ caller, body }) {
      const patientId = caller.role === "patient" ? caller.sub : String(body.patientId ?? "");
      const patient = await loadPatient(patientId); await assertCanViewPatient(caller, patient);
      const pharmacy = await getItem<any>("Pharmacies", { id: String(body.pharmacyId ?? "") });
      if (!pharmacy || pharmacy.active === false) throw badRequest("Choose a pharmacy");
      const meds = await loadActiveMeds(patient.id); const byId = new Map(meds.map((m) => [m.itemId, m]));
      const err = validateLines(body.items, new Set(byId.keys())); if (err) throw badRequest(err);
      const mode: OrderMode = body.mode === "Pickup" ? "Pickup" : "Delivery";
      const address = String(body.address ?? "").trim(); const phone = String(body.phone ?? "").replace(/[\s-]/g, "");
      if (!PHONE.test(phone)) throw badRequest("A contact number in international format is required, e.g. +919876543210");
      if (mode === "Delivery" && address.length < 8) throw badRequest("A delivery address is required");
      // One open order per patient+pharmacy+medicine would be too strict; instead stop accidental double submits.
      const recent = (await query<Order>("Orders", { index: "byPatient", pk: "patientId", pkValue: patient.id, forward: false, limit: 5 }))
        .find((o) => o.pharmacyId === pharmacy.id && OPEN_STATUSES.includes(o.status) && Date.now() - Date.parse(o.createdAt) < 60_000);
      if (recent) throw new HttpError(409, "An identical order was just placed. Check My orders");
      const items: OrderItem[] = (body.items as any[]).map((l) => { const m = byId.get(l.itemId)!; return { itemId: m.itemId, drugId: m.drugId, drugName: m.drugName, strength: m.strength, form: m.form, dose: m.dose, frequency: m.frequency, quantity: l.quantity, unitPrice: null }; });
      const now = nowIso();
      const order: Order = {
        id: randomUUID(), patientId: patient.id, patientName: patient.name, placedBy: caller.sub, placedByName: caller.name, placedByRole: caller.role,
        pharmacyId: pharmacy.id, pharmacyName: pharmacy.name, items, mode, address: mode === "Delivery" ? address : undefined, phone,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 300) || undefined : undefined,
        status: "Placed", total: null, history: [{ status: "Placed", at: now, by: caller.name }], createdAt: now, updatedAt: now,
      };
      await putItem("Orders", order as any);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "order.place", entity: `patient#${patient.id}`, after: { orderId: order.id, pharmacyId: pharmacy.id, items: items.length, mode } });
      await Promise.all((pharmacy.staffIds ?? []).map((u: string) => notify({ userId: u, type: "order", title: "New medicine order", body: `${patient.name}: ${items.length} medicine${items.length === 1 ? "" : "s"} for ${mode.toLowerCase()}.`, payload: { link: "/" }, dedupeKey: `order-new-${order.id}-${u}` }).catch(() => undefined)));
      return order;
    },
  },
  { method: "GET", path: "/orders", roles: ["patient", "caregiver", "pharmacy"], handler: ({ caller }) => ordersFor(caller) },
  {
    method: "POST", path: "/orders/:id/cancel", roles: ["patient", "caregiver"],
    async handler({ caller, params }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (!canCancel(o.status)) throw badRequest(`This order is already ${o.status.toLowerCase()} and can no longer be cancelled`);
      await move(o, "Cancelled", caller);
      const ph = await getItem<any>("Pharmacies", { id: o.pharmacyId });
      await Promise.all((ph?.staffIds ?? []).map((u: string) => notify({ userId: u, type: "order", title: "Order cancelled", body: `${o.patientName} cancelled their order.`, payload: { link: "/" }, dedupeKey: `order-cx-${o.id}-${u}` }).catch(() => undefined)));
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/orders/:id/accept", roles: ["pharmacy"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (o.status !== "Placed") throw badRequest(`This order is already ${o.status.toLowerCase()}`);
      const prices = new Map<string, number>((Array.isArray(body.prices) ? body.prices : []).map((p: any) => [String(p.itemId), Number(p.unitPrice)] as [string, number]));
      const items = o.items.map((i) => {
        const p = prices.get(i.itemId);
        if (p === undefined || !Number.isFinite(p) || p < 0 || p > 100000) throw badRequest(`Enter a price for ${i.drugName}`);
        return { ...i, unitPrice: Math.round(p * 100) / 100 };
      });
      const total = orderTotal(items);
      await move(o, "Accepted", caller, { items, total });
      await tell(o, "Order accepted", `${o.pharmacyName} accepted your order. Total ₹${total} to pay on ${o.mode === "Delivery" ? "delivery" : "pickup"}.`, `order-acc-${o.id}`);
      return { ok: true, total };
    },
  },
  {
    method: "POST", path: "/orders/:id/decline", roles: ["pharmacy"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (o.status !== "Placed") throw badRequest(`This order is already ${o.status.toLowerCase()}`);
      const reason = String(body.reason ?? "").trim(); if (reason.length < 3) throw badRequest("Give a short reason, e.g. medicine out of stock");
      await move(o, "Declined", caller, { declineReason: reason.slice(0, 300) });
      await tell(o, "Order declined", `${o.pharmacyName}: ${reason}. You can order from another pharmacy.`, `order-dec-${o.id}`);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/orders/:id/status", roles: ["pharmacy"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      const to = body.status as OrderStatus;
      if (!pharmacyNext(o.mode, o.status).includes(to)) throw badRequest(`An order that is "${o.status}" cannot move to "${to}"`);
      await move(o, to, caller);
      const msg: Record<string, string> = { Packed: "is packed", "Out for delivery": "is out for delivery", "Ready for pickup": "is ready for pickup", Delivered: "was delivered", Collected: "was collected" };
      await tell(o, `Order ${to.toLowerCase()}`, `Your order from ${o.pharmacyName} ${msg[to] ?? to}.`, `order-${to}-${o.id}`);
      return { ok: true };
    },
  },
];
