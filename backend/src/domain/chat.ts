import type { Role } from "../lib/types.js";

/** Nurses share one inbox per patient; doctors get one thread per (patient, doctor). */
export const NURSE_DESK = "nurses";
export const MAX_TEXT = 2000;

export interface ThreadKey { patientId: string; staffKey: string }
export interface ThreadSummary { id: string; emergency?: boolean; lastAt?: string }

/** Deterministic id, so the first message creates the thread and both sides address it the same way. */
export const threadId = (patientId: string, staffKey: string) => `${patientId}~${staffKey}`;
export function parseThreadId(id: string): ThreadKey | null {
  const [patientId, staffKey, ...rest] = id.split("~");
  return patientId && staffKey && !rest.length ? { patientId, staffKey } : null;
}

/**
 * Patient: only their own threads, and only with an assigned doctor or the nurse desk.
 * Doctor: only their own thread with a patient assigned to them. Nurse: any patient's nurse-desk thread.
 */
export function canUseThread(role: Role, sub: string, key: ThreadKey, assignedDoctors: string[]): boolean {
  const staffOk = key.staffKey === NURSE_DESK || assignedDoctors.includes(key.staffKey);
  switch (role) {
    case "patient": return key.patientId === sub && staffOk;
    case "doctor": return key.staffKey === sub && assignedDoctors.includes(sub);
    case "admin_nurse": return key.staffKey === NURSE_DESK;
    default: return false;
  }
}

/** Emergency threads first (most recent first), then everything else by latest activity. */
export function sortThreads<T extends ThreadSummary>(threads: T[]): T[] {
  return [...threads].sort((a, b) => Number(!!b.emergency) - Number(!!a.emergency) || (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/** Keeps the first thread per key (input already sorted), so a person never appears twice in an inbox. */
export function uniqueThreads<T extends ThreadSummary>(threads: T[], keyOf: (t: T) => string): T[] {
  const seen = new Set<string>();
  return threads.filter((t) => { const k = keyOf(t); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function cleanText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t && t.length <= MAX_TEXT ? t : null;
}
