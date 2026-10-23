import { reminderTimes } from "./doses.js";

export type OrderStatus = "Placed" | "Accepted" | "Declined" | "Packed" | "Out for delivery" | "Ready for pickup" | "Delivered" | "Collected" | "Cancelled";
export type OrderMode = "Delivery" | "Pickup";
export const OPEN_STATUSES: OrderStatus[] = ["Placed", "Accepted", "Packed", "Out for delivery", "Ready for pickup"];

/** Forward moves a pharmacy may make. Placed is resolved with accept/decline, so it is not listed here. */
export function pharmacyNext(mode: OrderMode, s: OrderStatus): OrderStatus[] {
  switch (s) {
    case "Accepted": return ["Packed"];
    case "Packed": return [mode === "Delivery" ? "Out for delivery" : "Ready for pickup"];
    case "Out for delivery": return ["Delivered"];
    case "Ready for pickup": return ["Collected"];
    default: return [];
  }
}
/** The patient (or caregiver) can cancel only before the pharmacy has packed anything. */
export const canCancel = (s: OrderStatus) => s === "Placed" || s === "Accepted";

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Suggested pack size from the prescription: units per dose x doses per day x days left. Liquids/injections default to one pack. */
export function suggestQuantity(med: { dose: string; form: string; frequency: string; timings?: string[]; endDate: string }, today: string): number {
  if (!/(tablet|capsule|tab|cap)/i.test(med.form)) return 1;
  const m = /^\s*(\d+)\s*\/\s*(\d+)|^\s*(\d+(?:\.\d+)?)/.exec(med.dose ?? "");
  const perDose = m ? (m[1] ? Number(m[1]) / Number(m[2]) : Number(m[3])) : 1;
  const perDay = reminderTimes(med.frequency, med.timings).length || 0;
  const days = Math.max(1, daysBetween(today, med.endDate) + 1);
  const units = perDay ? perDose * perDay * days : 10; // as-needed: a small default pack
  return Math.min(500, Math.max(1, Math.ceil(units)));
}

export interface OrderLineInput { itemId?: unknown; quantity?: unknown }
export function validateLines(lines: unknown, orderable: Set<string>): string | null {
  if (!Array.isArray(lines) || !lines.length) return "Choose at least one medicine";
  if (lines.length > 20) return "Too many medicines in one order";
  const seen = new Set<string>();
  for (const l of lines as OrderLineInput[]) {
    if (typeof l?.itemId !== "string" || !orderable.has(l.itemId)) return "You can only order medicines that are currently prescribed";
    if (seen.has(l.itemId)) return "A medicine appears twice in the order";
    seen.add(l.itemId);
    if (!Number.isInteger(l.quantity) || (l.quantity as number) < 1 || (l.quantity as number) > 500) return "Quantity must be a whole number from 1 to 500";
  }
  return null;
}
export const orderTotal = (items: { quantity: number; unitPrice?: number | null }[]) =>
  items.every((i) => typeof i.unitPrice === "number") ? Math.round(items.reduce((t, i) => t + i.quantity * (i.unitPrice as number), 0) * 100) / 100 : null;
