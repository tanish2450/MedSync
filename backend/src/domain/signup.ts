import { badRequest } from "../lib/http.js";

export const SIGNUP_ROLES = ["patient", "doctor", "pharmacy", "caregiver", "lab"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];
export const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
export const LANGUAGES = ["English", "Hindi", "Kannada", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali"];
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"];
export const RELATIONS = ["Spouse", "Parent", "Child", "Sibling", "Relative", "Friend", "Other"];

const PHONE = /^\+[1-9]\d{7,14}$/;
const REG_NO = /^[A-Za-z0-9/-]{4,30}$/;
const LICENCE_NO = /^[A-Za-z0-9/-]{4,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Collects every field problem so the UI can show all of them at once. */
export class Collector {
  errors: Record<string, string> = {};
  constructor(private body: any) {}
  private raw(k: string) { return this.body?.[k]; }
  text(k: string, label: string, min = 2, max = 200): string {
    const v = this.raw(k);
    if (typeof v !== "string" || v.trim().length < min) { this.errors[k] = `${label} is required`; return ""; }
    if (v.trim().length > max) { this.errors[k] = `${label} is too long`; return ""; }
    return v.trim();
  }
  optionalText(k: string, max = 500): string | undefined {
    const v = this.raw(k);
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || v.length > max) { this.errors[k] = `${k} is invalid`; return undefined; }
    return v.trim();
  }
  oneOf(k: string, label: string, allowed: string[]): string {
    const v = this.raw(k);
    if (typeof v !== "string" || !allowed.includes(v)) { this.errors[k] = `Choose a valid ${label}`; return ""; }
    return v;
  }
  phone(k: string, label = "Phone"): string {
    const v = this.raw(k);
    if (typeof v !== "string" || !PHONE.test(v.replace(/[\s-]/g, ""))) { this.errors[k] = `${label} must be in international format, e.g. +919876543210`; return ""; }
    return v.replace(/[\s-]/g, "");
  }
  number(k: string, label: string, min: number, max: number): number {
    const v = Number(this.raw(k));
    if (this.raw(k) === undefined || this.raw(k) === "" || !Number.isFinite(v) || v < min || v > max) { this.errors[k] = `${label} must be between ${min} and ${max}`; return NaN; }
    return v;
  }
  consent(k = "consent"): void { if (this.raw(k) !== true) this.errors[k] = "You must accept the terms and privacy consent"; }
  custom(k: string, msg: string) { this.errors[k] = msg; }
  done(): void { if (Object.keys(this.errors).length) throw badRequest("Please fix the highlighted fields", { fields: this.errors }); }
}

/** Whole years between dob and today (both YYYY-MM-DD). */
export function ageOn(dob: string, today: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age;
}

export function validatePatient(body: any, today: string) {
  const c = new Collector(body);
  const name = c.text("name", "Full name");
  const phone = c.phone("phone");
  const gender = c.oneOf("gender", "gender", GENDERS);
  const language = c.oneOf("language", "language", LANGUAGES);
  const bloodGroup = c.oneOf("bloodGroup", "blood group", BLOOD_GROUPS);
  const address = c.text("address", "Address", 5, 300);
  let dob = ""; let age = NaN;
  if (typeof body?.dob !== "string" || !DATE.test(body.dob) || Number.isNaN(Date.parse(body.dob))) c.custom("dob", "Date of birth is required (YYYY-MM-DD)");
  else if (body.dob > today) c.custom("dob", "Date of birth cannot be in the future");
  else { dob = body.dob; age = ageOn(dob, today); if (age > 120) c.custom("dob", "Date of birth looks wrong"); }
  const emergencyContact = { name: c.text("emergencyName", "Emergency contact name"), phone: c.phone("emergencyPhone", "Emergency contact phone"), relation: c.oneOf("emergencyRelation", "relation", RELATIONS) };
  const isMinor = !Number.isNaN(age) && age < 18;
  let guardian: { name: string; phone: string; relation: string; email?: string } | undefined;
  if (isMinor) {
    guardian = { name: c.text("guardianName", "Guardian name"), phone: c.phone("guardianPhone", "Guardian phone"), relation: c.oneOf("guardianRelation", "guardian relation", RELATIONS), email: c.optionalText("guardianEmail", 200) };
  }
  const allergies = parseAllergies(body?.allergies, c);
  const conditions = parseList(body?.conditions);
  c.consent();
  c.done();
  return { name, phone, gender, language, bloodGroup, address, dob, age, emergencyContact, isMinor, guardian, allergies, conditions };
}

function parseList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 100)).slice(0, 30);
}
function parseAllergies(v: unknown, c: Collector) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { c.custom("allergies", "Allergies must be a list"); return []; }
  return v.filter((a) => a && typeof a.substance === "string" && a.substance.trim())
    .slice(0, 30).map((a) => ({ substance: a.substance.trim().slice(0, 100), reaction: typeof a.reaction === "string" ? a.reaction.trim().slice(0, 200) : undefined }));
}

export function validateDoctor(body: any) {
  const c = new Collector(body);
  const name = c.text("name", "Full name");
  const phone = c.phone("phone");
  const specialty = c.text("specialty", "Specialty");
  const qualifications = c.text("qualifications", "Qualifications", 2, 200);
  const registrationNo = c.text("registrationNo", "Medical council registration number", 4, 30);
  if (registrationNo && !REG_NO.test(registrationNo)) c.custom("registrationNo", "Registration number must be 4–30 letters, digits, / or -");
  const registrationCouncil = c.text("registrationCouncil", "Registering medical council", 2, 100);
  const experienceYears = c.number("experienceYears", "Years of experience", 0, 70);
  const fee = c.number("fee", "Consultation fee", 0, 100000);
  const languages = parseList(body?.languages);
  if (!languages.length) c.custom("languages", "Choose at least one language");
  const hospitalName = c.text("hospitalName", "Hospital / clinic name");
  const hospitalAddress = c.text("hospitalAddress", "Hospital / clinic address", 5, 300);
  const hospitalCity = c.text("hospitalCity", "City", 2, 80);
  const hospitalPhone = c.phone("hospitalPhone", "Hospital phone");
  const lat = c.number("lat", "Latitude", -90, 90);
  const lng = c.number("lng", "Longitude", -180, 180);
  c.consent();
  c.done();
  return {
    name, phone, specialty, qualifications, registrationNo, registrationCouncil, experienceYears, fee, languages,
    hospitalName, hospitalAddress, hospitalCity, hospitalPhone, lat, lng,
  };
}

export function validatePharmacy(body: any) {
  const c = new Collector(body);
  const staffName = c.text("name", "Your full name");
  const phone = c.phone("phone", "Your phone");
  const pharmacyName = c.text("pharmacyName", "Pharmacy name");
  const licenceNo = c.text("licenceNo", "Drug licence number", 4, 40);
  if (licenceNo && !LICENCE_NO.test(licenceNo)) c.custom("licenceNo", "Licence number must be 4–40 letters, digits, / or -");
  const gstin = c.optionalText("gstin", 20);
  const address = c.text("address", "Pharmacy address", 5, 300);
  const city = c.text("city", "City", 2, 80);
  const pharmacyPhone = c.phone("pharmacyPhone", "Pharmacy phone");
  const hours = c.text("hours", "Opening hours", 3, 60);
  const pharmacistName = c.text("pharmacistName", "Registered pharmacist name");
  const pharmacistRegNo = c.text("pharmacistRegNo", "Pharmacist registration number", 4, 30);
  const lat = c.number("lat", "Latitude", -90, 90);
  const lng = c.number("lng", "Longitude", -180, 180);
  c.consent();
  c.done();
  return { staffName, phone, pharmacyName, licenceNo, gstin, address, city, pharmacyPhone, hours, pharmacistName, pharmacistRegNo, lat, lng };
}

export function validateCaregiver(body: any) {
  const c = new Collector(body);
  const name = c.text("name", "Full name");
  const phone = c.phone("phone");
  const language = c.oneOf("language", "language", LANGUAGES);
  c.consent();
  c.done();
  return { name, phone, language };
}
