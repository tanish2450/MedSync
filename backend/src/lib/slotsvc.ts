import { query } from "./db.js";
import { generateSlots } from "../domain/slots.js";
import { addDays } from "../domain/versioning.js";
import { istDate } from "../domain/doses.js";
import type { Doctor } from "./types.js";

/** First `max` open slots for a doctor within the next `days` days (drives the slot-button row on doctor cards). */
export async function nextSlotsFor(d: Doctor, days = 7, max = 6): Promise<{ start: string; end: string }[]> {
  if (!d.active) return [];
  const from = istDate(new Date()); const to = addDays(from, days - 1);
  const locks = await query<{ slotStart: string }>("SlotLocks", { pk: "doctorId", pkValue: d.id, skName: "slotStart", skBetween: [`${from}T00:00:00+05:30`, `${to}T23:59:59+05:30`] });
  const booked = new Set(locks.map((l) => l.slotStart));
  const out: { start: string; end: string }[] = [];
  for (let i = 0; i < days && out.length < max; i++) out.push(...generateSlots(d.availability, addDays(from, i), booked));
  return out.slice(0, max);
}
