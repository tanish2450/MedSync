import type { Drug, MedStatus, PrescriptionItem } from "../lib/types.js";
import { parseFrequency } from "./doses.js";

export const versionKey = (itemId: string, version: number) => `${itemId}#${String(version).padStart(5, "0")}`;

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Latest version per itemId (rows are immutable; history = all rows). */
export function latestByItem(rows: PrescriptionItem[]): PrescriptionItem[] {
  const m = new Map<string, PrescriptionItem>();
  for (const r of rows) { const c = m.get(r.itemId); if (!c || r.version > c.version) m.set(r.itemId, r); }
  return [...m.values()];
}

/** Active = latest version is Active/Modified and not past end date. */
export function activeMeds(rows: PrescriptionItem[], today: string): PrescriptionItem[] {
  return latestByItem(rows).filter((r) => (r.status === "Active" || r.status === "Modified") && r.endDate >= today);
}

export interface NewItemInput {
  drug: Drug; strength: string; form: string; route?: string; dose: string; frequency: string;
  timings?: string[]; durationDays: number; instructions?: string;
}
export interface Actor { sub: string; name: string }

export function newVersionRow(opts: {
  patientId: string; prescriptionId: string; itemId: string; version: number; drug: Drug;
  input: Omit<NewItemInput, "drug">; status: MedStatus; changeType: PrescriptionItem["changeType"];
  changeReason?: string; actor: Actor; startDate: string; now: string;
}): PrescriptionItem {
  const { input, drug } = opts;
  return {
    patientId: opts.patientId, versionKey: versionKey(opts.itemId, opts.version), itemId: opts.itemId,
    version: opts.version, prescriptionId: opts.prescriptionId, drugId: drug.drugId, drugName: drug.genericName,
    ingredients: drug.ingredients, classes: drug.classes, strength: input.strength, form: input.form,
    route: input.route ?? "oral", dose: input.dose, frequency: input.frequency, timings: input.timings,
    durationDays: input.durationDays, instructions: input.instructions, startDate: opts.startDate,
    endDate: addDays(opts.startDate, input.durationDays - 1), status: opts.status, doctorId: opts.actor.sub,
    doctorName: opts.actor.name, changeReason: opts.changeReason, changeType: opts.changeType,
    createdBy: opts.actor.sub, createdAt: opts.now,
  };
}

export function validateItemInput(i: Partial<NewItemInput> & { drugId?: string }): string | null {
  if (!i.drugId) return "drugId is required (free-text drug names are not allowed)";
  if (!i.dose?.trim()) return "dose is required";
  if (!i.frequency?.trim()) return "frequency is required";
  if (i.timings?.length) {
    if (!i.timings.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return "timings must be HH:mm (24-hour, IST)";
    const wanted = parseFrequency(i.frequency);
    if (wanted && "prn" in wanted) return "As-needed medicines cannot have fixed reminder times";
    const given = new Set(i.timings).size;
    if (wanted && "times" in wanted && wanted.times.length !== given) return `Frequency "${i.frequency}" means ${wanted.times.length} dose(s) a day but ${given} reminder time(s) were set`;
  }
  if (!parseFrequency(i.frequency, i.timings)) return "frequency not understood: use e.g. once daily, twice daily, three times daily, every 8 hours, at night, as needed, or set explicit timings (HH:mm)";
  if (!Number.isInteger(i.durationDays) || (i.durationDays as number) < 1 || (i.durationDays as number) > 730) return "durationDays must be an integer 1-730";
  if (!i.strength?.trim()) return "strength is required";
  if (!i.form?.trim()) return "form is required";
  return null;
}
