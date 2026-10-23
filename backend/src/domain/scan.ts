import type { Drug } from "../lib/types.js";
import { parseFrequency, reminderTimes } from "./doses.js";

/** What the vision model read off the paper. Everything is untrusted text until a doctor confirms it. */
export interface ExtractedMed { name: string | null; strength: string | null; form: string | null; dose: string | null; frequency: string | null; durationDays: number | null; instructions: string | null }
export interface Extraction { legible: boolean; prescriberName: string | null; prescriptionDate: string | null; medicines: ExtractedMed[] }

export const REQUIRED_FIELDS = ["drug", "form", "strength", "dose", "frequency", "durationDays"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export interface DraftItem {
  rawName: string; drugId: string | null; drugName: string | null; form: string | null; strength: string | null; dose: string | null;
  frequency: string | null; frequencyRaw: string | null; timings: string[] | null; durationDays: number | null; instructions: string | null;
  /** Fields the doctor MUST fill in or confirm before the medicine can be added. */
  missing: RequiredField[];
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t && !/^(null|n\/a|na|none|unknown|-+)$/i.test(t) ? t.slice(0, max) : null;
};

/** Pull the JSON object out of a model reply (it may arrive wrapped in a code fence or prose). */
export function parseModelJson(text: string): unknown {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export function sanitizeExtraction(raw: unknown): Extraction {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.medicines) ? o.medicines : [];
  const medicines: ExtractedMed[] = list.slice(0, 20).map((m: any) => {
    const d = Number(m?.durationDays);
    return {
      name: str(m?.name, 100), strength: str(m?.strength, 40), form: str(m?.form, 40), dose: str(m?.dose, 60),
      frequency: str(m?.frequency, 80), durationDays: Number.isInteger(d) && d >= 1 && d <= 730 ? d : null, instructions: str(m?.instructions, 200),
    };
  }).filter((m) => m.name);
  const date = str(o.prescriptionDate, 10);
  return { legible: o.legible !== false && medicines.length > 0, prescriberName: str(o.prescriberName, 100), prescriptionDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, medicines };
}

const norm = (s: string) => s.toLowerCase().replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu)\b/g, " ").replace(/\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup|inj|injection|sr|er|xr|cr|ds|forte)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Match a written medicine name to the catalogue by generic or brand name. Ambiguous matches return null (the doctor picks). */
export function matchDrug(name: string, drugs: Drug[]): Drug | null {
  const n = norm(name); if (n.length < 3) return null;
  const hits = new Map<string, { drug: Drug; score: number }>();
  for (const d of drugs) {
    const names = [d.genericName, ...(d.brandNames ?? [])].map(norm).filter(Boolean);
    let score = 0;
    for (const c of names) {
      if (c === n) score = Math.max(score, 3);
      else if (n.split(" ").includes(c) || c.split(" ").includes(n)) score = Math.max(score, 2);
    }
    if (score) hits.set(d.drugId, { drug: d, score });
  }
  const all = [...hits.values()].sort((a, b) => b.score - a.score);
  if (!all.length) return null;
  return all.length === 1 || all[0].score > all[1].score ? all[0].drug : null;
}

const compact = (s: string) => s.toLowerCase().replace(/\s+/g, "");
export function matchStrength(s: string | null, strengths: string[]): string | null {
  if (!s) return strengths.length === 1 ? strengths[0] : null;
  return strengths.find((x) => compact(x) === compact(s)) ?? null;
}
const FORM_ALIAS: Record<string, string> = { tab: "tablet", tabs: "tablet", cap: "capsule", caps: "capsule", syp: "syrup", inj: "injection" };
export function matchForm(f: string | null, drug: Drug): string | null {
  if (f) {
    const w = FORM_ALIAS[f.toLowerCase()] ?? f.toLowerCase();
    const hit = drug.forms.find((x) => x.form.toLowerCase() === w || w.includes(x.form.toLowerCase()));
    if (hit) return hit.form;
  }
  return drug.forms.length === 1 ? drug.forms[0].form : null;
}

export function buildDraft(ex: Extraction, drugs: Drug[]): DraftItem[] {
  return ex.medicines.map((m) => {
    const drug = m.name ? matchDrug(m.name, drugs) : null;
    const form = drug ? matchForm(m.form, drug) : null;
    const strength = drug ? matchStrength(m.strength, drug.forms.find((f) => f.form === form)?.strengths ?? drug.forms.flatMap((f) => f.strengths)) : null;
    const parsed = m.frequency ? parseFrequency(m.frequency) : null;
    const times = m.frequency && parsed && "times" in parsed ? reminderTimes(m.frequency) : null;
    const item: DraftItem = {
      rawName: m.name ?? "", drugId: drug?.drugId ?? null, drugName: drug?.genericName ?? null, form, strength, dose: m.dose,
      frequency: parsed ? m.frequency : null, frequencyRaw: m.frequency, timings: times, durationDays: m.durationDays, instructions: m.instructions, missing: [],
    };
    if (!drug) item.missing.push("drug");
    if (!form) item.missing.push("form");
    if (!strength) item.missing.push("strength");
    if (!item.dose) item.missing.push("dose");
    if (!item.frequency) item.missing.push("frequency");
    if (!item.durationDays) item.missing.push("durationDays");
    return item;
  });
}

/** Cheap file-signature check so a renamed non-image is rejected before it is sent anywhere. */
export function imageKind(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
