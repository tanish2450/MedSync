import type { Availability } from "../lib/types.js";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const IST = "+05:30"; // India has no DST; MVP fixes doctor timezone to Asia/Kolkata.

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const pad = (n: number) => String(n).padStart(2, "0");
const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export const slotIso = (date: string, hhmm: string) => `${date}T${hhmm}:00${IST}`;
export const dayOfWeek = (date: string) => DAYS[new Date(`${date}T12:00:00${IST}`).getUTCDay()];
// getUTCDay of noon IST (06:30 UTC) is the same calendar day, so this is stable.

export interface Slot { start: string; end: string }

/** Slots = configured weekly hours − breaks − leave − already booked − slots in the past. */
export function generateSlots(av: Availability, date: string, bookedStarts: Set<string>, now = new Date()): Slot[] {
  if (av.leaveDates.includes(date)) return [];
  const windows = av.weeklyHours[dayOfWeek(date)] ?? [];
  const out: Slot[] = [];
  for (const w of windows) {
    for (let t = toMin(w.start); t + av.slotMinutes <= toMin(w.end); t += av.slotMinutes) {
      const inBreak = av.breaks.some((b) => t < toMin(b.end) && t + av.slotMinutes > toMin(b.start));
      if (inBreak) continue;
      const start = slotIso(date, fromMin(t)); const end = slotIso(date, fromMin(t + av.slotMinutes));
      if (bookedStarts.has(start)) continue;
      if (new Date(start).getTime() <= now.getTime()) continue;
      out.push({ start, end });
    }
  }
  return out;
}

/** True iff `start` is a real generated slot (ignoring booked state) — prevents booking arbitrary times. */
export function isConfiguredSlot(av: Availability, start: string): boolean {
  const date = start.slice(0, 10);
  return generateSlots(av, date, new Set(), new Date(0)).some((s) => s.start === start);
}
