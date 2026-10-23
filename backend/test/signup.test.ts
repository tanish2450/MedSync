import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, validatePatient, validateDoctor, validatePharmacy, validateCaregiver } from "../src/domain/signup.js";
import { HttpError } from "../src/lib/http.js";

const TODAY = "2026-10-23";
const patient = (o: any = {}) => ({
  name: "Asha Rao", phone: "+919876543210", gender: "Female", language: "English", bloodGroup: "O+", address: "12 MG Road, Bengaluru",
  dob: "1990-05-10", emergencyName: "Ravi Rao", emergencyPhone: "+919800000001", emergencyRelation: "Spouse", consent: true, ...o,
});
const fields = (fn: () => unknown): Record<string, string> => {
  try { fn(); } catch (e) { assert.ok(e instanceof HttpError); return (e.details as any).fields; }
  assert.fail("expected validation failure");
};

test("ageOn handles birthdays", () => {
  assert.equal(ageOn("2008-10-23", TODAY), 18);
  assert.equal(ageOn("2008-10-24", TODAY), 17);
  assert.equal(ageOn("1990-01-01", TODAY), 36);
});
test("valid adult patient passes", () => {
  const r = validatePatient(patient(), TODAY);
  assert.equal(r.isMinor, false); assert.equal(r.age, 36);
});
test("patient missing fields reports all", () => {
  const f = fields(() => validatePatient({ consent: false }, TODAY));
  for (const k of ["name", "phone", "gender", "language", "bloodGroup", "address", "dob", "emergencyName", "consent"]) assert.ok(f[k], k);
});
test("minor requires guardian", () => {
  const f = fields(() => validatePatient(patient({ dob: "2012-01-01" }), TODAY));
  assert.ok(f.guardianName && f.guardianPhone && f.guardianRelation);
  const r = validatePatient(patient({ dob: "2012-01-01", guardianName: "Mr Rao", guardianPhone: "+919811111111", guardianRelation: "Parent" }), TODAY);
  assert.equal(r.isMinor, true); assert.equal(r.guardian?.name, "Mr Rao");
});
test("future or absurd dob rejected", () => {
  assert.ok(fields(() => validatePatient(patient({ dob: "2030-01-01" }), TODAY)).dob);
  assert.ok(fields(() => validatePatient(patient({ dob: "1800-01-01" }), TODAY)).dob);
});
test("bad phone rejected", () => {
  assert.ok(fields(() => validatePatient(patient({ phone: "98765" }), TODAY)).phone);
});
const doctor = (o: any = {}) => ({
  name: "Dr Meera", phone: "+919876500000", specialty: "Cardiology", qualifications: "MBBS, MD", registrationNo: "KMC/12345", registrationCouncil: "Karnataka Medical Council",
  experienceYears: 8, fee: 800, languages: ["English"], hospitalName: "City Hospital", hospitalAddress: "1 Hospital Rd, Bengaluru", hospitalCity: "Bengaluru",
  hospitalPhone: "+918012345678", lat: 12.97, lng: 77.59, consent: true, ...o,
});
test("doctor valid / invalid", () => {
  assert.equal(validateDoctor(doctor()).hospitalName, "City Hospital");
  const f = fields(() => validateDoctor(doctor({ registrationNo: "x", hospitalName: "", languages: [], lat: 200 })));
  assert.ok(f.registrationNo && f.hospitalName && f.languages && f.lat);
});
const pharmacy = (o: any = {}) => ({
  name: "Sam", phone: "+919876511111", pharmacyName: "Care Pharmacy", licenceNo: "KA/DL/2024/1234", address: "5 Main St", city: "Bengaluru",
  pharmacyPhone: "+918011111111", hours: "08:00-22:00", pharmacistName: "Sam Joseph", pharmacistRegNo: "KSPC1234", lat: 12.9, lng: 77.6, consent: true, ...o,
});
test("pharmacy valid / invalid", () => {
  assert.equal(validatePharmacy(pharmacy()).licenceNo, "KA/DL/2024/1234");
  const f = fields(() => validatePharmacy(pharmacy({ licenceNo: "", hours: "", consent: false })));
  assert.ok(f.licenceNo && f.hours && f.consent);
});
test("caregiver valid", () => {
  assert.equal(validateCaregiver({ name: "Ria", phone: "+919800000009", language: "Hindi", consent: true }).name, "Ria");
  assert.ok(fields(() => validateCaregiver({})).name);
});
