import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCatalogue, expandInteractions } from "../src/seed/catalogue.js";
import { runSafetyChecks, unacknowledged } from "../src/domain/safety.js";
import { generateSlots, isConfiguredSlot, dayOfWeek } from "../src/domain/slots.js";
import { can, canViewPatient } from "../src/domain/permissions.js";
import { activeMeds, latestByItem, newVersionRow, validateItemInput, versionKey } from "../src/domain/versioning.js";
import { pairKey } from "../src/domain/interactions.js";
import { toMedicationRequest } from "../src/domain/fhir.js";

const cat = parseCatalogue(readFileSync(new URL("../src/seed/drugs.txt", import.meta.url), "utf8"));
const ds = JSON.parse(readFileSync(new URL("../src/seed/interactions.json", import.meta.url), "utf8"));
const interactions = expandInteractions(ds, cat);
const drug = (id: string) => cat.find((d) => d.drugId === id)!;

test("catalogue parses with unique ids and ingredients", () => {
  assert.ok(cat.length > 100);
  assert.equal(new Set(cat.map((d) => d.drugId)).size, cat.length);
  assert.deepEqual(drug("amoxicillin-clavulanic-acid").ingredients, ["amoxicillin", "clavulanic acid"]);
});

test("every interaction in the dataset references real catalogue ingredients", () => {
  assert.ok(interactions.length > 60);
});

test("warfarin + aspirin yields Major alert with stored text and needs acknowledgement", () => {
  const alerts = runSafetyChecks({ allergies: [], newDrugs: [drug("aspirin")], activeDrugs: [drug("warfarin")], interactions });
  const a = alerts.find((x) => x.type === "interaction")!;
  assert.equal(a.severity, "Major");
  assert.equal(a.requiresAck, true);
  assert.match(a.effect!, /bleeding/i);
  assert.equal(unacknowledged(alerts, []).length >= 1, true);
  assert.equal(unacknowledged(alerts, alerts.map((x) => ({ key: x.key, reason: "Benefit outweighs risk" }))).length, 0);
});

test("sildenafil + nitrate class is Contraindicated (class expansion)", () => {
  const alerts = runSafetyChecks({ allergies: [], newDrugs: [drug("sildenafil")], activeDrugs: [drug("isosorbide-mononitrate")], interactions });
  assert.equal(alerts.find((x) => x.type === "interaction")!.severity, "Contraindicated");
});

test("NSAID class + warfarin covers ibuprofen/diclofenac", () => {
  for (const id of ["ibuprofen", "diclofenac", "naproxen"]) {
    const a = runSafetyChecks({ allergies: [], newDrugs: [drug(id)], activeDrugs: [drug("warfarin")], interactions });
    assert.ok(a.some((x) => x.type === "interaction" && x.severity === "Major"), id);
  }
});

test("interactions between two NEW drugs in the same prescription are detected", () => {
  const a = runSafetyChecks({ allergies: [], newDrugs: [drug("tramadol"), drug("sertraline")], activeDrugs: [], interactions });
  assert.ok(a.some((x) => x.type === "interaction" && x.severity === "Major"));
});

test("unknown pair yields no interaction alert (neutral wording is UI-side)", () => {
  const a = runSafetyChecks({ allergies: [], newDrugs: [drug("cetirizine")], activeDrugs: [drug("amlodipine")], interactions });
  assert.equal(a.filter((x) => x.type === "interaction").length, 0);
});

test("allergy by class (penicillin) blocks amoxicillin and needs override", () => {
  const a = runSafetyChecks({ allergies: [{ substance: "Penicillin", reaction: "Rash" }], newDrugs: [drug("amoxicillin")], activeDrugs: [], interactions });
  assert.equal(a[0].type, "allergy");
  assert.equal(a[0].requiresAck, true);
});

test("duplicate therapy: same class and same ingredient", () => {
  const sameClass = runSafetyChecks({ allergies: [], newDrugs: [drug("atorvastatin")], activeDrugs: [drug("rosuvastatin")], interactions });
  assert.ok(sameClass.some((x) => x.type === "duplicate"));
  const sameIng = runSafetyChecks({ allergies: [], newDrugs: [drug("amoxicillin")], activeDrugs: [drug("amoxicillin-clavulanic-acid")], interactions });
  assert.ok(sameIng.some((x) => x.type === "duplicate" && /ingredient/.test(x.title)));
});

test("pairKey is order independent", () => { assert.equal(pairKey("A", "b"), pairKey("b", "a")); });

const av = { slotMinutes: 30, weeklyHours: { mon: [{ start: "09:00", end: "11:00" }] }, breaks: [{ start: "10:00", end: "10:30" }], leaveDates: ["2026-11-02"] };
test("slot generation honours hours, breaks, leave, booked and past", () => {
  assert.equal(dayOfWeek("2026-10-26"), "mon");
  const now = new Date("2026-10-23T00:00:00Z");
  const s = generateSlots(av, "2026-10-26", new Set(["2026-10-26T09:30:00+05:30"]), now).map((x) => x.start.slice(11, 16));
  assert.deepEqual(s, ["09:00", "10:30"]);
  assert.deepEqual(generateSlots(av, "2026-11-02", new Set(), now), []);
  assert.deepEqual(generateSlots(av, "2026-10-27", new Set(), now), []);
  assert.equal(isConfiguredSlot(av, "2026-10-26T09:00:00+05:30"), true);
  assert.equal(isConfiguredSlot(av, "2026-10-26T09:10:00+05:30"), false);
});

test("permission matrix: admin can edit patients but never medicines", () => {
  assert.equal(can("admin_nurse", "patient.manage"), true);
  assert.equal(can("admin_nurse", "medicine.edit"), false);
  assert.equal(can("doctor", "medicine.edit"), true);
  assert.equal(can("patient", "medicine.edit"), false);
  assert.equal(can("pharmacy", "patient.viewRecord"), false);
  assert.equal(can("admin_nurse", "insurance.update"), true);
  assert.equal(can("doctor", "insurance.update"), false);
});

test("ownership: doctor only assigned, patient only self, caregiver only linked", () => {
  const patient = { id: "p1", assignedDoctors: ["d1"] };
  assert.equal(canViewPatient({ role: "doctor", sub: "d1", patient }), true);
  assert.equal(canViewPatient({ role: "doctor", sub: "d2", patient }), false);
  assert.equal(canViewPatient({ role: "patient", sub: "p2", patient }), false);
  assert.equal(canViewPatient({ role: "caregiver", sub: "c1", patient }), false);
  assert.equal(canViewPatient({ role: "caregiver", sub: "c1", patient, caregiverLinkActive: true }), true);
  assert.equal(canViewPatient({ role: "pharmacy", sub: "x", patient }), false);
});

test("versioning: modify keeps both versions; discontinue leaves history but leaves active list", () => {
  const actor = { sub: "d1", name: "Dr A" };
  const base = { patientId: "p1", prescriptionId: "rx1", itemId: "it1", drug: drug("amlodipine"), actor, startDate: "2026-10-23" };
  const input = { strength: "5 mg", form: "tablet", dose: "1 tablet", frequency: "once daily", durationDays: 30 };
  const v1 = newVersionRow({ ...base, version: 1, input, status: "Active", changeType: "created", now: "t1" });
  const v2 = newVersionRow({ ...base, version: 2, input: { ...input, strength: "10 mg" }, status: "Modified", changeType: "modified", changeReason: "BP uncontrolled", now: "t2" });
  assert.equal(v1.versionKey, versionKey("it1", 1));
  assert.equal(latestByItem([v1, v2])[0].strength, "10 mg");
  assert.equal(activeMeds([v1, v2], "2026-10-24").length, 1);
  const v3 = newVersionRow({ ...base, version: 3, input, status: "Discontinued", changeType: "discontinued", changeReason: "Switch", now: "t3" });
  assert.equal(activeMeds([v1, v2, v3], "2026-10-24").length, 0);
  assert.equal(activeMeds([v1], "2027-01-01").length, 0, "expired by end date");
  assert.equal(v1.endDate, "2026-11-21"); // 30-day course = 30 calendar days inclusive
});

test("validation rejects free-text drugs and bad durations", () => {
  assert.match(validateItemInput({ dose: "1", frequency: "od", durationDays: 5, strength: "x", form: "y" })!, /drugId/);
  assert.match(validateItemInput({ drugId: "a", dose: "1", frequency: "od", durationDays: 0, strength: "x", form: "y" })!, /durationDays/);
  assert.equal(validateItemInput({ drugId: "a", dose: "1", frequency: "od", durationDays: 5, strength: "x", form: "y" }), null);
});

test("FHIR MedicationRequest mapping", () => {
  const v = newVersionRow({ patientId: "p1", prescriptionId: "rx", itemId: "it", version: 1, drug: drug("warfarin"), actor: { sub: "d", name: "Dr" }, startDate: "2026-10-23",
    input: { strength: "5 mg", form: "tablet", dose: "1", frequency: "od", durationDays: 10 }, status: "Discontinued", changeType: "discontinued", now: "t" });
  const f = toMedicationRequest(v) as any;
  assert.equal(f.resourceType, "MedicationRequest");
  assert.equal(f.status, "stopped");
  assert.equal(f.subject.reference, "Patient/p1");
});

import { parseFrequency, generateDoseEvents, isOverdue, needsReminder, computeAdherence, evaluateEscalation } from "../src/domain/doses.js";
import type { DoseEvent } from "../src/lib/types.js";

test("frequency parsing: common phrases, explicit timings, PRN, unknown", () => {
  assert.deepEqual(parseFrequency("once daily before breakfast"), { times: ["08:00"] });
  assert.deepEqual(parseFrequency("once daily at night"), { times: ["21:00"] });
  assert.deepEqual(parseFrequency("twice daily with meals"), { times: ["08:00", "20:00"] });
  assert.deepEqual(parseFrequency("TDS"), { times: ["08:00", "14:00", "21:00"] });
  assert.equal((parseFrequency("four times a day") as any).times.length, 4);
  assert.deepEqual(parseFrequency("every 8 hours"), { times: ["06:00", "14:00", "22:00"] });
  assert.deepEqual(parseFrequency("whatever", ["07:30", "19:30"]), { times: ["07:30", "19:30"] });
  assert.deepEqual(parseFrequency("as needed for pain"), { prn: true });
  assert.equal(parseFrequency("sometimes maybe"), null);
  assert.equal(parseFrequency("period"), null, "no substring false-positives for 'od'");
});

const baseItem = () => newVersionRow({ patientId: "p1", prescriptionId: "rx", itemId: "it1", version: 1, drug: drug("metformin"), actor: { sub: "d", name: "Dr" }, startDate: "2026-10-23",
  input: { strength: "500 mg", form: "tablet", dose: "1 tablet", frequency: "twice daily", durationDays: 3 }, status: "Active", changeType: "created", now: "t" });

test("dose events: per frequency x duration, future only, rolling horizon", () => {
  const now = new Date("2026-10-23T03:00:00Z"); // 08:30 IST: the 08:00 dose on day 1 is already past
  const ev = generateDoseEvents(baseItem(), { now });
  assert.equal(ev.length, 5); // 3 days x 2 - 1 past
  assert.equal(ev[0].scheduledTime, "2026-10-23T20:00:00+05:30");
  assert.ok(ev.every((e) => e.status === "Scheduled"));
  assert.equal(generateDoseEvents(baseItem(), { now, includePast: true }).length, 6);
  const long = { ...baseItem(), durationDays: 400, endDate: "2027-12-01" };
  assert.equal(generateDoseEvents(long, { now, horizonDays: 10 }).length, 20 - 1);
});

test("grace window flips to Missed; reminder window is 10 minutes", () => {
  const e = generateDoseEvents(baseItem(), { now: new Date("2026-10-22T00:00:00Z") })[0]; // 08:00 IST = 02:30Z
  assert.equal(isOverdue(e, new Date("2026-10-23T03:29:00Z")), false);
  assert.equal(isOverdue(e, new Date("2026-10-23T03:30:00Z")), true);
  assert.equal(needsReminder(e, new Date("2026-10-23T02:19:00Z")), false);
  assert.equal(needsReminder(e, new Date("2026-10-23T02:21:00Z")), true);
  assert.equal(needsReminder({ ...e, reminderSentAt: "x" }, new Date("2026-10-23T02:21:00Z")), false);
});

const ev = (day: string, time: string, status: DoseEvent["status"], extra: Partial<DoseEvent> = {}): DoseEvent => ({
  patientId: "p1", doseKey: `${day}T${time}#a`, itemId: "a", version: 1, drugId: "metformin", drugName: "Metformin", strength: "500 mg", dose: "1", scheduledTime: `${day}T${time}:00+05:30`, status, critical: false, ...extra });

test("adherence, streak, per-medicine and part-of-day", () => {
  const now = new Date("2026-10-23T12:00:00Z"); // 17:30 IST
  const events = [ev("2026-10-21", "08:00", "Taken"), ev("2026-10-21", "20:00", "Taken"), ev("2026-10-22", "08:00", "Taken"), ev("2026-10-22", "20:00", "Taken"),
    ev("2026-10-23", "08:00", "Taken"), ev("2026-10-23", "20:00", "Scheduled")];
  const a = computeAdherence(events, now);
  assert.equal(a.percent, 100); assert.equal(a.streakDays, 3); assert.equal(a.due, 5);
  const b = computeAdherence([...events.slice(0, 4), ev("2026-10-23", "08:00", "Missed")], now);
  assert.equal(b.percent, 80); assert.equal(b.streakDays, 0);
  assert.equal(b.byPartOfDay.morning.due, 3);
  assert.equal(computeAdherence([], now).percent, null);
});

test("escalation: 2 consecutive misses -> caregiver; <60% or critical miss -> doctor; healthy -> none", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const healthy = [ev("2026-10-22", "08:00", "Taken"), ev("2026-10-22", "20:00", "Taken"), ev("2026-10-23", "08:00", "Taken"), ev("2026-10-21", "08:00", "Taken")];
  assert.deepEqual(evaluateEscalation(healthy, now), { caregiver: null, doctor: null });
  const twoMissed = [...healthy.slice(0, 2), ev("2026-10-23", "08:00", "Missed"), ev("2026-10-23", "09:00", "Missed")];
  assert.match(evaluateEscalation(twoMissed, now).caregiver!, /2 doses missed in a row/);
  const poor = [ev("2026-10-20", "08:00", "Missed"), ev("2026-10-21", "08:00", "Taken"), ev("2026-10-21", "20:00", "Missed"), ev("2026-10-22", "08:00", "Missed"), ev("2026-10-22", "20:00", "Taken")];
  const r = evaluateEscalation(poor, now);
  assert.match(r.caregiver!, /40%/); assert.match(r.doctor!, /40%/);
  const crit = [ev("2026-10-22", "08:00", "Taken"), ev("2026-10-23", "08:00", "Missed", { critical: true, drugName: "Warfarin" })];
  assert.match(evaluateEscalation(crit, now).doctor!, /critical medicine \(Warfarin\)/);
});

import { reminderTimes } from "../src/domain/doses.js";
import { validateItemInput } from "../src/domain/versioning.js";
test("dash notation and word lists map to the right clock times", () => {
  assert.deepEqual(reminderTimes("1-0-1"), ["08:00", "21:00"]);
  assert.deepEqual(reminderTimes("1-1-1"), ["08:00", "14:00", "21:00"]);
  assert.deepEqual(reminderTimes("0-0-1"), ["21:00"]);
  assert.deepEqual(reminderTimes("morning and night"), ["08:00", "21:00"]);
  assert.deepEqual(reminderTimes("as needed"), []);
  assert.equal(parseFrequency("0-0-0"), null);
});
test("explicit timings win and must agree with the frequency", () => {
  assert.deepEqual(reminderTimes("twice daily", ["09:00", "21:30"]), ["09:00", "21:30"]);
  const base = { drugId: "d", dose: "1 tablet", strength: "500 mg", form: "tablet", durationDays: 5 };
  assert.match(validateItemInput({ ...base, frequency: "twice daily", timings: ["08:00", "14:00", "21:00"] }) ?? "", /2 dose/);
  assert.match(validateItemInput({ ...base, frequency: "as needed", timings: ["08:00"] }) ?? "", /As-needed/);
  assert.equal(validateItemInput({ ...base, frequency: "twice daily", timings: ["09:00", "21:30"] }), null);
});
test("every N hours gives 24/N doses a day", () => {
  assert.deepEqual(reminderTimes("every 6 hours"), ["00:00", "06:00", "12:00", "18:00"]);
  assert.deepEqual(reminderTimes("every 8 hours"), ["06:00", "14:00", "22:00"]);
  assert.deepEqual(reminderTimes("every 12 hours"), ["06:00", "18:00"]);
});
