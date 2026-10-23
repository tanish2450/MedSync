import type { DoseEvent, DoseStatus, PrescriptionItem } from "../lib/types.js";
import { addDays } from "./versioning.js";

const IST = "+05:30";
export const GRACE_MINUTES = 60;
export const REMINDER_LEAD_MINUTES = 10;

export type ParsedFrequency = { times: string[] } | { prn: true } | null;

/**
 * Turns a frequency phrase into clock times (IST). Returns null when it cannot be understood,
 * in which case the API rejects the prescription instead of guessing. Explicit `timings` ("HH:mm") always win.
 */
export function parseFrequency(freq: string, timings?: string[]): ParsedFrequency {
  if (timings?.length && timings.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return { times: [...new Set(timings)].sort() };
  const f = (freq ?? "").toLowerCase();
  if (/\b(prn|sos|as needed|when required|if needed)\b/.test(f)) return { prn: true };
  // Indian dash notation: morning-afternoon-night, e.g. 1-0-1 (also 1-1-1-1 = morning/afternoon/evening/night)
  const dash = /\b([01])\s*-\s*([01])\s*-\s*([01])(?:\s*-\s*([01]))?\b/.exec(f);
  if (dash) {
    const slots = dash[4] !== undefined ? ["08:00", "13:00", "18:00", "21:00"] : ["08:00", "14:00", "21:00"];
    const times = slots.filter((_, i) => dash[i + 1] === "1");
    return times.length ? { times } : null;
  }
  const words: [RegExp, string][] = [[/\bmorning\b/, "08:00"], [/\b(afternoon|noon|lunch)\b/, "14:00"], [/\bevening\b/, "18:00"], [/\b(night|bedtime)\b/, "21:00"]];
  const hits = words.filter(([re]) => re.test(f)).map(([, t]) => t);
  if (hits.length >= 2) return { times: hits };
  const nTimes = /\b(\d)\s*(?:x|times?)\s*(?:a|per)?\s*(?:day|daily)\b/.exec(f);
  if (nTimes && Number(nTimes[1]) >= 5 && Number(nTimes[1]) <= 8) {
    const n = Number(nTimes[1]); const step = Math.floor(960 / (n - 1));
    return { times: Array.from({ length: n }, (_, i) => { const m = 480 + i * step; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }) };
  }
  const every = /every\s+(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\b/.exec(f);
  if (every) {
    const n = Number(every[1]);
    if (n < 1 || n > 24) return null;
    // 24/n doses a day starting at 06:00 and wrapping past midnight (every 6 h = 06,12,18,00)
    const count = Math.floor(24 / n);
    return { times: Array.from({ length: count }, (_, i) => `${String((6 + i * n) % 24).padStart(2, "0")}:00`).sort() };
  }
  if (/\b(four times|4 times|qid|q\.i\.d|4x)\b/.test(f)) return { times: ["08:00", "12:00", "17:00", "21:00"] };
  if (/\b(three times|thrice|3 times|tds|tid|t\.i\.d|3x)\b/.test(f)) return { times: ["08:00", "14:00", "21:00"] };
  if (/\b(twice|two times|2 times|bd|bid|b\.i\.d|2x)\b/.test(f)) return { times: ["08:00", "20:00"] };
  if (/\b(at night|bedtime|nocte|before bed)\b/.test(f)) return { times: ["21:00"] };
  if (/\b(once|one time|1 time|daily|od|qd|every day|1x)\b/.test(f)) return { times: ["08:00"] };
  return null;
}

/** Reminder clock times (IST, "HH:mm") a prescription line will produce, or [] for as-needed / unknown. */
export function reminderTimes(freq: string, timings?: string[]): string[] {
  const p = parseFrequency(freq, timings);
  return p && "times" in p ? p.times : [];
}

export const doseKey = (scheduledTime: string, itemId: string) => `${scheduledTime}#${itemId}`;
export const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export interface GenOpts { now: Date; horizonDays?: number; includePast?: boolean; critical?: boolean }

/** Individual dose events from `startDate` to `endDate` (inclusive), limited to a rolling horizon. */
export function generateDoseEvents(item: PrescriptionItem, opts: GenOpts): DoseEvent[] {
  const parsed = parseFrequency(item.frequency, item.timings);
  if (!parsed || "prn" in parsed) return [];
  const today = istDate(opts.now);
  const horizonEnd = addDays(today, (opts.horizonDays ?? 60) - 1);
  const first = opts.includePast ? item.startDate : item.startDate > today ? item.startDate : today;
  const last = item.endDate < horizonEnd ? item.endDate : horizonEnd;
  const out: DoseEvent[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    for (const t of parsed.times) {
      const scheduledTime = `${d}T${t}:00${IST}`;
      if (!opts.includePast && new Date(scheduledTime).getTime() <= opts.now.getTime()) continue;
      out.push({
        patientId: item.patientId, doseKey: doseKey(scheduledTime, item.itemId), itemId: item.itemId, version: item.version, drugId: item.drugId,
        drugName: item.drugName, strength: item.strength, dose: item.dose, scheduledTime, status: "Scheduled", critical: !!opts.critical, instructions: item.instructions,
      });
    }
  }
  return out;
}

/** Scheduled doses past their grace window must flip to Missed. */
export const isOverdue = (e: Pick<DoseEvent, "status" | "scheduledTime">, now: Date, grace = GRACE_MINUTES) =>
  e.status === "Scheduled" && new Date(e.scheduledTime).getTime() + grace * 60000 <= now.getTime();

export const needsReminder = (e: DoseEvent, now: Date, lead = REMINDER_LEAD_MINUTES) => {
  const t = new Date(e.scheduledTime).getTime();
  return e.status === "Scheduled" && !e.reminderSentAt && t > now.getTime() && t - now.getTime() <= lead * 60000;
};

export interface Adherence {
  percent: number | null; taken: number; missed: number; skipped: number; due: number; streakDays: number;
  perMedicine: { drugId: string; drugName: string; percent: number | null; taken: number; due: number }[];
  byPartOfDay: Record<"morning" | "afternoon" | "evening" | "night", { taken: number; due: number }>;
}
const part = (iso: string) => { const h = Number(new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(11, 13)); return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night"; };

/** Adherence over doses already resolved (Taken/Skipped/Missed). Skipped and Missed both count against adherence. */
export function computeAdherence(events: DoseEvent[], now: Date): Adherence {
  const resolved = events.filter((e) => e.status !== "Scheduled" && new Date(e.scheduledTime).getTime() <= now.getTime());
  const taken = resolved.filter((e) => e.status === "Taken").length;
  const missed = resolved.filter((e) => e.status === "Missed").length;
  const skipped = resolved.filter((e) => e.status === "Skipped").length;
  const due = resolved.length;
  const pm = new Map<string, { drugId: string; drugName: string; taken: number; due: number }>();
  const byPartOfDay = { morning: { taken: 0, due: 0 }, afternoon: { taken: 0, due: 0 }, evening: { taken: 0, due: 0 }, night: { taken: 0, due: 0 } };
  for (const e of resolved) {
    const m = pm.get(e.drugId) ?? { drugId: e.drugId, drugName: e.drugName, taken: 0, due: 0 };
    m.due++; if (e.status === "Taken") m.taken++; pm.set(e.drugId, m);
    const p = byPartOfDay[part(e.scheduledTime)]; p.due++; if (e.status === "Taken") p.taken++;
  }
  // Streak = consecutive days (most recent first) on which every resolved dose was Taken.
  const days = new Map<string, boolean>();
  for (const e of resolved) { const d = e.scheduledTime.slice(0, 10); days.set(d, (days.get(d) ?? true) && e.status === "Taken"); }
  let streak = 0; let d = istDate(now);
  if (!days.has(d)) d = addDays(d, -1);
  while (days.get(d)) { streak++; d = addDays(d, -1); }
  return {
    percent: due ? Math.round((taken / due) * 100) : null, taken, missed, skipped, due, streakDays: streak,
    perMedicine: [...pm.values()].map((m) => ({ ...m, percent: m.due ? Math.round((m.taken / m.due) * 100) : null })),
    byPartOfDay,
  };
}

export interface EscalationRules { consecutiveMissedForCaregiver: number; caregiverBelowPercent: number; doctorBelowPercent: number; minDosesForPercent: number }
export const DEFAULT_RULES: EscalationRules = { consecutiveMissedForCaregiver: 2, caregiverBelowPercent: 70, doctorBelowPercent: 60, minDosesForPercent: 4 };

/** Deterministic escalation: caregiver on repeated misses / <70 % over 7 days; doctor on sustained <60 % or any missed critical medicine. */
export function evaluateEscalation(last7d: DoseEvent[], now: Date, rules = DEFAULT_RULES): { caregiver: string | null; doctor: string | null } {
  const resolved = last7d.filter((e) => e.status !== "Scheduled" && new Date(e.scheduledTime).getTime() <= now.getTime()).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  const a = computeAdherence(resolved, now);
  let consecutive = 0; for (let i = resolved.length - 1; i >= 0 && resolved[i].status === "Missed"; i--) consecutive++;
  let caregiver: string | null = null; let doctor: string | null = null;
  if (consecutive >= rules.consecutiveMissedForCaregiver) caregiver = `${consecutive} doses missed in a row`;
  else if (a.percent !== null && a.due >= rules.minDosesForPercent && a.percent < rules.caregiverBelowPercent) caregiver = `Adherence is ${a.percent}% over the last 7 days`;
  const critical = resolved.find((e) => e.critical && e.status === "Missed");
  if (critical) doctor = `Missed a critical medicine (${critical.drugName})`;
  else if (a.percent !== null && a.due >= rules.minDosesForPercent && a.percent < rules.doctorBelowPercent) doctor = `Adherence is ${a.percent}% over the last 7 days`;
  return { caregiver, doctor };
}

export const isFinalStatus = (s: DoseStatus) => s !== "Scheduled";
