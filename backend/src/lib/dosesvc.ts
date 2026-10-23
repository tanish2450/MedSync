import { batchDelete, batchPut, query } from "./db.js";
import type { Drug, DoseEvent, PrescriptionItem } from "./types.js";
import { generateDoseEvents, istDate } from "../domain/doses.js";

/** IST wall-clock ISO string with +05:30 offset, comparable (lexicographically) with stored scheduledTime values. */
export const toIst = (d: Date) => `${new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 19)}+05:30`;

export async function futureScheduled(patientId: string, now: Date): Promise<DoseEvent[]> {
  return query<DoseEvent>("DoseEvents", {
    pk: "patientId", pkValue: patientId, skName: "doseKey", skBetween: [toIst(now), "9999"], filter: { expr: "#st = :sc", names: { "#st": "status" }, values: { ":sc": "Scheduled" } },
  });
}

/** Replace all still-scheduled future doses of one prescription item (used on create / modify / discontinue). */
export async function regenerateDoses(item: PrescriptionItem, drug: Drug | null, now = new Date()) {
  const existing = (await futureScheduled(item.patientId, now)).filter((e) => e.itemId === item.itemId);
  if (existing.length) await batchDelete("DoseEvents", existing.map((e) => ({ patientId: e.patientId, doseKey: e.doseKey })));
  if (!drug || item.status === "Discontinued" || item.status === "Completed") return 0;
  const events = generateDoseEvents(item, { now, critical: !!drug.criticalDrug });
  if (events.length) await batchPut("DoseEvents", events as any);
  return events.length;
}

export async function dosesBetween(patientId: string, fromDateIst: string, toDateIst: string): Promise<DoseEvent[]> {
  return query<DoseEvent>("DoseEvents", { pk: "patientId", pkValue: patientId, skName: "doseKey", skBetween: [`${fromDateIst}T00:00:00+05:30`, `${toDateIst}T23:59:59+05:30#~`] });
}
export { istDate };
