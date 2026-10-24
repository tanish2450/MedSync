import { Collector } from "./signup.js";

/*
 * Lab tests: a fixed catalogue of common panels with adult reference ranges.
 * Ranges are defaults; a lab may send its own range per result row, which then wins.
 * Flags are computed server-side from the numbers so the UI never decides what is "abnormal".
 */
export interface Analyte { key: string; name: string; unit: string; low?: number; high?: number; critLow?: number; critHigh?: number; text?: boolean }
export interface LabTest { code: string; name: string; sample: "Blood" | "Urine" | "Stool"; fasting?: boolean; tatHours: number; analytes: Analyte[] }

export const LAB_TESTS: LabTest[] = [
  { code: "CBC", name: "Complete blood count", sample: "Blood", tatHours: 6, analytes: [
    { key: "hb", name: "Haemoglobin", unit: "g/dL", low: 12, high: 17, critLow: 7, critHigh: 20 },
    { key: "wbc", name: "WBC count", unit: "×10³/µL", low: 4, high: 11, critLow: 2, critHigh: 30 },
    { key: "plt", name: "Platelets", unit: "×10³/µL", low: 150, high: 450, critLow: 50, critHigh: 1000 },
  ] },
  { code: "FBS", name: "Fasting blood sugar", sample: "Blood", fasting: true, tatHours: 4, analytes: [
    { key: "fbs", name: "Glucose, fasting", unit: "mg/dL", low: 70, high: 100, critLow: 50, critHigh: 400 },
  ] },
  { code: "HBA1C", name: "HbA1c", sample: "Blood", tatHours: 12, analytes: [
    { key: "hba1c", name: "HbA1c", unit: "%", low: 4, high: 5.7, critHigh: 14 },
  ] },
  { code: "LIPID", name: "Lipid profile", sample: "Blood", fasting: true, tatHours: 12, analytes: [
    { key: "tc", name: "Total cholesterol", unit: "mg/dL", high: 200 },
    { key: "ldl", name: "LDL cholesterol", unit: "mg/dL", high: 100 },
    { key: "hdl", name: "HDL cholesterol", unit: "mg/dL", low: 40 },
    { key: "tg", name: "Triglycerides", unit: "mg/dL", high: 150, critHigh: 1000 },
  ] },
  { code: "KFT", name: "Kidney function test", sample: "Blood", tatHours: 12, analytes: [
    { key: "creat", name: "Creatinine", unit: "mg/dL", low: 0.6, high: 1.3, critHigh: 5 },
    { key: "urea", name: "Blood urea", unit: "mg/dL", low: 15, high: 40, critHigh: 150 },
    { key: "k", name: "Potassium", unit: "mmol/L", low: 3.5, high: 5.1, critLow: 2.8, critHigh: 6.2 },
    { key: "na", name: "Sodium", unit: "mmol/L", low: 135, high: 145, critLow: 120, critHigh: 160 },
  ] },
  { code: "LFT", name: "Liver function test", sample: "Blood", tatHours: 12, analytes: [
    { key: "alt", name: "ALT (SGPT)", unit: "U/L", high: 40, critHigh: 1000 },
    { key: "ast", name: "AST (SGOT)", unit: "U/L", high: 40, critHigh: 1000 },
    { key: "bili", name: "Total bilirubin", unit: "mg/dL", low: 0.2, high: 1.2, critHigh: 15 },
  ] },
  { code: "TFT", name: "Thyroid profile", sample: "Blood", tatHours: 24, analytes: [
    { key: "tsh", name: "TSH", unit: "µIU/mL", low: 0.4, high: 4.5, critHigh: 50 },
    { key: "ft4", name: "Free T4", unit: "ng/dL", low: 0.8, high: 1.8 },
  ] },
  { code: "INR", name: "PT / INR", sample: "Blood", tatHours: 4, analytes: [
    { key: "inr", name: "INR", unit: "", low: 0.8, high: 1.2, critHigh: 5 },
  ] },
  { code: "VITD", name: "Vitamin D (25-OH)", sample: "Blood", tatHours: 24, analytes: [
    { key: "vitd", name: "25-OH Vitamin D", unit: "ng/mL", low: 30, high: 100, critLow: 10 },
  ] },
  { code: "URINE", name: "Urine routine", sample: "Urine", tatHours: 6, analytes: [
    { key: "protein", name: "Protein", unit: "", text: true },
    { key: "sugar", name: "Sugar", unit: "", text: true },
    { key: "pus", name: "Pus cells", unit: "/hpf", low: 0, high: 5 },
  ] },
];
export const testByCode = (code: string) => LAB_TESTS.find((t) => t.code === code);

export type Flag = "Normal" | "Low" | "High" | "Critical low" | "Critical high" | "Reported";
/** Critical limits are checked before the normal range, so a dangerous value is never shown as just "High". */
export function flagValue(v: number, r: { low?: number; high?: number; critLow?: number; critHigh?: number }): Flag {
  if (r.critLow !== undefined && v <= r.critLow) return "Critical low";
  if (r.critHigh !== undefined && v >= r.critHigh) return "Critical high";
  if (r.low !== undefined && v < r.low) return "Low";
  if (r.high !== undefined && v > r.high) return "High";
  return "Normal";
}
export const isCritical = (f: Flag) => f === "Critical low" || f === "Critical high";

export type LabStatus = "Ordered" | "Sample collected" | "Processing" | "Report ready" | "Cancelled";
/** Forward moves a lab makes before entering results; results themselves move the order to "Report ready". */
export function labNext(s: LabStatus): LabStatus[] {
  return s === "Ordered" ? ["Sample collected"] : s === "Sample collected" ? ["Processing"] : [];
}
export const canEnterResults = (s: LabStatus) => s === "Sample collected" || s === "Processing";
export const canCancelLab = (s: LabStatus) => s === "Ordered";
export const canChooseLab = (s: LabStatus) => s === "Ordered";

export interface ResultRow { code: string; key: string; name: string; unit: string; value: number | string; low?: number; high?: number; flag: Flag }
const num = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number(v));

/** Turns what the lab typed into flagged rows. Every analyte of every ordered test needs a value. */
export function buildResults(codes: string[], input: Record<string, unknown>[]): ResultRow[] {
  const byKey = new Map(input.map((r) => [`${r.code}.${r.key}`, r]));
  const rows: ResultRow[] = []; const missing: string[] = [];
  for (const code of codes) {
    const t = testByCode(code); if (!t) continue;
    for (const a of t.analytes) {
      const r = byKey.get(`${code}.${a.key}`);
      const raw = r?.value;
      if (raw === undefined || raw === null || String(raw).trim() === "") { missing.push(`${t.name}: ${a.name}`); continue; }
      if (a.text) { rows.push({ code, key: a.key, name: a.name, unit: a.unit, value: String(raw).trim().slice(0, 60), flag: "Reported" }); continue; }
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 100000) { missing.push(`${t.name}: ${a.name} (not a number)`); continue; }
      // a lab-supplied range overrides the catalogue default; critical limits always come from the catalogue
      const low = num(r?.low) ?? a.low, high = num(r?.high) ?? a.high;
      rows.push({ code, key: a.key, name: a.name, unit: a.unit, value: v, low, high, flag: flagValue(v, { low, high, critLow: a.critLow, critHigh: a.critHigh }) });
    }
  }
  if (missing.length) throw Object.assign(new Error("missing"), { missing });
  return rows;
}

export function validateLab(body: any) {
  const c = new Collector(body);
  const staffName = c.text("name", "Your full name");
  const phone = c.phone("phone", "Your phone");
  const labName = c.text("labName", "Lab name");
  const licenceNo = c.text("licenceNo", "Lab registration / licence number", 4, 40);
  if (licenceNo && !/^[A-Za-z0-9/-]{4,40}$/.test(licenceNo)) c.custom("licenceNo", "Licence number must be 4–40 letters, digits, / or -");
  const accreditation = c.optionalText("accreditation", 60);
  const address = c.text("address", "Lab address", 5, 300);
  const city = c.text("city", "City", 2, 80);
  const labPhone = c.phone("labPhone", "Lab phone");
  const hours = c.text("hours", "Opening hours", 3, 60);
  const lat = c.number("lat", "Latitude", -90, 90);
  const lng = c.number("lng", "Longitude", -180, 180);
  const tests = Array.isArray(body?.tests) ? body.tests.filter((x: unknown) => typeof x === "string" && testByCode(x)) : [];
  if (!tests.length) c.custom("tests", "Choose at least one test your lab offers");
  const homeCollection = body?.homeCollection === true;
  c.consent();
  c.done();
  return { staffName, phone, labName, licenceNo, accreditation, address, city, labPhone, hours, lat, lng, tests: tests as string[], homeCollection };
}
