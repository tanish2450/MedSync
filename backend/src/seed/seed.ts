/**
 * Seeds a deployed MedSync stack with a drug catalogue, curated interaction dataset and demo users/data.
 *   SEED_PASSWORD='<strong password>' npm run seed        (AWS credentials + region of the deployed stack required)
 * Optional: STACK_NAME (default MedSyncStack), SEED_EMAIL_DOMAIN (default example.com; no emails are sent).
 * Demo data is FICTIONAL. Clinic names are invented; coordinates are approximate Bengaluru neighbourhood centres.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import {
  AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { TABLES, tableEnvVar } from "../lib/tables.js";
import { batchPut, putItem } from "../lib/db.js";
import { GRACE_MINUTES } from "../domain/doses.js";
import { parseCatalogue, expandInteractions } from "./catalogue.js";
import { newVersionRow, addDays } from "../domain/versioning.js";
import { generateDoseEvents } from "../domain/doses.js";
import type { Availability, Doctor, Insurance, Patient, PrescriptionItem, Role } from "../lib/types.js";

const stackName = process.env.STACK_NAME ?? "MedSyncStack";
const password = process.env.SEED_PASSWORD;
const domain = process.env.SEED_EMAIL_DOMAIN ?? "example.com";
if (!password || password.length < 12) { console.error("Set SEED_PASSWORD (min 12 chars, upper/lower/digit/symbol). It is never stored in code."); process.exit(1); }

const idp = new CognitoIdentityProviderClient({});
let POOL = "";

async function ensureUser(email: string, name: string, role: Role): Promise<string> {
  try {
    const r = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: email }));
    return r.UserAttributes!.find((a) => a.Name === "sub")!.Value!;
  } catch (e: any) { if (e.name !== "UserNotFoundException") throw e; }
  const r = await idp.send(new AdminCreateUserCommand({
    UserPoolId: POOL, Username: email, MessageAction: "SUPPRESS",
    UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }, { Name: "name", Value: name }],
  }));
  await idp.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL, Username: email, Password: password!, Permanent: true }));
  await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: email, GroupName: role }));
  return r.User!.Attributes!.find((a) => a.Name === "sub")!.Value!;
}

const av: Availability = {
  slotMinutes: 30,
  weeklyHours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [{ start: "09:00", end: "13:00" }, { start: "16:00", end: "19:00" }]])),
  breaks: [{ start: "11:00", end: "11:15" }], leaveDates: [],
};

async function main() {
  const cf = await new CloudFormationClient({}).send(new DescribeStacksCommand({ StackName: stackName }));
  const outs = Object.fromEntries((cf.Stacks![0].Outputs ?? []).map((o) => [o.OutputKey!, o.OutputValue!]));
  POOL = outs.UserPoolId;
  const names = JSON.parse(outs.TableNames) as Record<string, string>;
  for (const k of Object.keys(TABLES)) process.env[tableEnvVar(k)] = names[k];

  const here = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  const catalogue = parseCatalogue(here("./drugs.txt"));
  const ds = JSON.parse(here("./interactions.json"));
  const interactions = expandInteractions(ds, catalogue);
  await batchPut("DrugCatalogue", catalogue as any);
  await batchPut("DrugInteractions", interactions as any);
  console.log(`catalogue: ${catalogue.length} drugs, interactions: ${interactions.length} pairs (${ds.dataset})`);
  const drug = (id: string) => catalogue.find((d) => d.drugId === id)!;

  const now = new Date().toISOString();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const email = (s: string) => `${s}@${domain}`;

  // Staff
  const adminId = await ensureUser(email("nurse.demo"), "Priya (Nurse)", "admin_nurse");
  await putItem("Users", { id: adminId, role: "admin_nurse", name: "Priya (Nurse)", email: email("nurse.demo"), language: "en", status: "active" });

  const docDefs = [
    ["dr.rao", "Dr. Anita Rao", "Cardiology", "Indiranagar Heart Clinic (demo)", "100 Feet Rd, Indiranagar, Bengaluru", 12.9784, 77.6408, 800],
    ["dr.shetty", "Dr. Vikram Shetty", "General Medicine", "Koramangala Family Clinic (demo)", "5th Block, Koramangala, Bengaluru", 12.9352, 77.6245, 500],
    ["dr.nair", "Dr. Meera Nair", "Endocrinology", "Jayanagar Diabetes Centre (demo)", "4th Block, Jayanagar, Bengaluru", 12.9308, 77.5838, 700],
    ["dr.gowda", "Dr. Karthik Gowda", "Orthopaedics", "Whitefield Bone & Joint (demo)", "ITPL Main Rd, Whitefield, Bengaluru", 12.9698, 77.75, 600],
    ["dr.khan", "Dr. Sana Khan", "Dermatology", "HSR Skin Clinic (demo)", "Sector 2, HSR Layout, Bengaluru", 12.9116, 77.6389, 600],
  ] as const;
  const docIds: Record<string, string> = {};
  for (const [k, name, spec, clinic, addr, lat, lng, fee] of docDefs) {
    const id = await ensureUser(email(k), name, "doctor"); docIds[k] = id;
    const d: Doctor = {
      id, name, email: email(k), phone: "+91 98000 1" + String(1000 + docDefs.findIndex((x) => x[0] === k)), specialty: spec, registrationNo: `DEMO-${k.toUpperCase()}`, qualifications: "MBBS, MD (demo record)",
      languages: ["English", "Hindi", "Kannada"], fee, clinic: { name: clinic, address: addr, lat, lng }, consultationHours: "Mon-Sat 9-1, 4-7",
      availability: av, onlineStatus: "Available", active: true, googleCalendarConnected: false,
    };
    await putItem("Doctors", d as any);
    await putItem("Users", { id, role: "doctor", name, email: d.email, language: "en", status: "active" });
  }

  // Patients: [key,name,doctors,allergies,conditions,insurance status]
  type P = [string, string, string[], { substance: string; reaction?: string }[], string[], Insurance["status"], string];
  const pats: P[] = [
    ["ramesh", "Ramesh Iyer", ["dr.rao", "dr.shetty"], [], ["Atrial fibrillation"], "Active", "O+"],
    ["lakshmi", "Lakshmi Devi", ["dr.shetty", "dr.nair"], [{ substance: "penicillin", reaction: "Rash" }], ["Type 2 diabetes", "Hypertension"], "Active", "B+"],
    ["arjun", "Arjun Mehta", ["dr.rao", "dr.shetty"], [], ["Angina"], "Pending", "A+"],
    ["fatima", "Fatima Sheikh", ["dr.nair"], [], ["Hypothyroidism"], "Active", "AB+"],
    ["suresh", "Suresh Kumar", ["dr.rao", "dr.shetty"], [], ["Dyslipidaemia"], "Expired", "O-"],
    ["deepa", "Deepa Nambiar", ["dr.gowda"], [{ substance: "sulfonamide", reaction: "Hives" }], ["Osteoarthritis"], "Rejected", "A-"],
    ["imran", "Imran Pasha", ["dr.khan"], [], [], "Active", "B-"],
    ["kavya", "Kavya Reddy", ["dr.shetty", "dr.khan"], [], ["Migraine"], "Pending", "O+"],
    ["john", "John D'Souza", ["dr.shetty", "dr.rao"], [], ["Hypertension"], "Active", "A+"],
    ["geeta", "Geeta Patil", ["dr.nair", "dr.shetty"], [], ["Type 2 diabetes"], "Expired", "B+"],
  ];
  const pid: Record<string, string> = {};
  for (const [k, name, docs, allergies, conds, insStatus, bg] of pats) {
    const id = await ensureUser(email(`pt.${k}`), name, "patient"); pid[k] = id;
    const p: Patient = {
      id, name, email: email(`pt.${k}`), phone: "+91 90000 0" + String(Math.floor(Math.random() * 90000) + 10000), bloodGroup: bg, language: "en",
      address: "Bengaluru, Karnataka", emergencyContact: { name: "Family contact", phone: "+91 98000 00000", relation: "Relative" },
      assignedDoctors: docs.map((d) => docIds[d]), allergies, conditions: conds, active: true, createdAt: now, updatedAt: now,
    };
    await putItem("Patients", p as any);
    await putItem("Users", { id, role: "patient", name, email: p.email, language: "en", status: "active" });
    const ins: Insurance = {
      patientId: id, provider: ["Star Health", "HDFC ERGO", "Niva Bupa", "ICICI Lombard"][name.length % 4] + " (demo)", policyNo: `DEMO${100000 + name.length * 7919}`,
      validFrom: addDays(today, -300), validTo: insStatus === "Expired" ? addDays(today, -10) : addDays(today, insStatus === "Active" ? 20 : 200),
      status: insStatus, coverageType: "Individual floater", notes: insStatus === "Rejected" ? "Claim documents incomplete" : undefined, updatedBy: "Priya (Nurse)", updatedAt: now,
    };
    await putItem("Insurance", ins as any);
  }

  // Existing prescriptions from different doctors (so the cross-doctor interaction demo works)
  const seededRows: { row: PrescriptionItem; patient: string }[] = [];
  const rx = async (patient: string, doc: string, drugId: string, strength: string, form: string, dose: string, freq: string, days: number) => {
    const rows: PrescriptionItem = newVersionRow({
      patientId: pid[patient], prescriptionId: randomUUID(), itemId: randomUUID(), version: 1, drug: drug(drugId),
      input: { strength, form, dose, frequency: freq, durationDays: days }, status: "Active", changeType: "created",
      actor: { sub: docIds[doc], name: docDefs.find((d) => d[0] === doc)![1] }, startDate: addDays(today, -7), now,
    });
    await putItem("PrescriptionItems", rows as any);
    seededRows.push({ row: rows, patient });
  };
  await rx("ramesh", "dr.rao", "warfarin", "5 mg", "tablet", "1 tablet", "once daily", 180);
  await rx("ramesh", "dr.shetty", "pantoprazole", "40 mg", "tablet", "1 tablet", "once daily before breakfast", 90);
  await rx("lakshmi", "dr.nair", "metformin", "500 mg", "tablet", "1 tablet", "twice daily with meals", 90);
  await rx("lakshmi", "dr.shetty", "telmisartan", "40 mg", "tablet", "1 tablet", "once daily", 90);
  await rx("arjun", "dr.rao", "isosorbide-mononitrate", "20 mg", "tablet", "1 tablet", "twice daily", 60);
  await rx("fatima", "dr.nair", "levothyroxine", "50 mcg", "tablet", "1 tablet", "once daily, empty stomach", 90);
  await rx("suresh", "dr.rao", "simvastatin", "20 mg", "tablet", "1 tablet", "once daily at night", 90);
  await rx("john", "dr.rao", "amlodipine", "5 mg", "tablet", "1 tablet", "once daily", 90);
  await rx("john", "dr.shetty", "lisinopril", "10 mg", "tablet", "1 tablet", "once daily", 90);
  await rx("geeta", "dr.nair", "glimepiride", "2 mg", "tablet", "1 tablet", "once daily before breakfast", 90);

  // Dose schedules + 7 days of realistic history so adherence dashboards have content.
  // Ramesh (warfarin, critical) is deliberately poor and ends on two misses to demo escalation; others are mostly adherent.
  const nowD = new Date(); const pastCut = nowD.getTime() - GRACE_MINUTES * 60000;
  let rnd = 7; const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  let nDoses = 0;
  for (const { row, patient } of seededRows) {
    const evs = generateDoseEvents(row, { now: nowD, includePast: true, critical: !!drug(row.drugId).criticalDrug });
    const past = evs.filter((e) => new Date(e.scheduledTime).getTime() < pastCut);
    past.forEach((e, i) => {
      const poor = patient === "ramesh"; const lastTwo = i >= past.length - 2;
      const takenP = poor ? 0.5 : 0.93;
      const taken = poor && lastTwo && drug(row.drugId).criticalDrug ? false : rand() < takenP;
      e.status = taken ? "Taken" : "Missed";
      if (taken) { e.confirmedAt = e.scheduledTime; e.confirmedBy = pid[patient]; }
    });
    await batchPut("DoseEvents", evs as any); nDoses += evs.length;
  }
  console.log(`dose events: ${nDoses} (past 7 days with history + upcoming schedule)`);

  // Caregivers
  for (const [cg, name, patient] of [["cg.ramesh", "Sunita Iyer", "ramesh"], ["cg.lakshmi", "Mohan Rao", "lakshmi"]] as const) {
    const id = await ensureUser(email(cg), name, "caregiver");
    await putItem("Users", { id, role: "caregiver", name, email: email(cg), language: "en", status: "active" });
    await putItem("CaregiverLinks", { patientId: pid[patient], caregiverId: id, caregiverEmail: email(cg), caregiverName: name, status: "Active", permissions: ["view", "mark-dose"], createdAt: now });
  }

  // Pharmacies (inventory arrives with the ordering module)
  const pharmacies = [
    ["Indiranagar Pharmacy (demo)", "Indiranagar, Bengaluru", 12.9719, 77.6412],
    ["Koramangala MedPoint (demo)", "Koramangala 5th Block, Bengaluru", 12.9345, 77.6190],
    ["Jayanagar Care Pharmacy (demo)", "Jayanagar 4th Block, Bengaluru", 12.9250, 77.5938],
    ["Whitefield Wellness Pharmacy (demo)", "Whitefield, Bengaluru", 12.9690, 77.7490],
    ["HSR 24x7 Pharmacy (demo)", "HSR Layout, Bengaluru", 12.9121, 77.6446],
  ];
  for (const [i, [name, address, lat, lng]] of pharmacies.entries()) {
    const id = randomUUID(); const staffIds: string[] = [];
    if (i === 0) {
      const sid = await ensureUser(email("pharmacy.demo"), "Pharmacy staff", "pharmacy"); staffIds.push(sid);
      await putItem("Users", { id: sid, role: "pharmacy", name: "Pharmacy staff", email: email("pharmacy.demo"), language: "en", status: "active", pharmacyId: id });
    }
    await putItem("Pharmacies", { id, name, address, lat, lng, hours: "08:00-22:00", phone: "+91 80000 00000", staffIds, active: true, createdAt: now });
  }

  // Diagnostic labs; the first one gets a demo staff login
  const labs = [
    ["Indiranagar Diagnostics (demo)", "100 Feet Road, Indiranagar, Bengaluru", 12.9784, 77.6408, true],
    ["Jayanagar Path Labs (demo)", "11th Main, Jayanagar 4th Block, Bengaluru", 12.9282, 77.5826, false],
  ] as const;
  const ALL_TESTS = ["CBC", "FBS", "HBA1C", "LIPID", "KFT", "LFT", "TFT", "INR", "VITD", "URINE"];
  for (const [i, [name, address, lat, lng, home]] of labs.entries()) {
    const id = randomUUID(); const staffIds: string[] = [];
    if (i === 0) {
      const sid = await ensureUser(email("lab.demo"), "Lab staff", "lab"); staffIds.push(sid);
      await putItem("Users", { id: sid, role: "lab", name: "Lab staff", email: email("lab.demo"), language: "en", status: "active", labId: id });
    }
    await putItem("Labs", { id, name, address, lat, lng, hours: "07:00-21:00", phone: "+91 80000 11111", tests: ALL_TESTS, homeCollection: home, staffIds, active: true, verified: true, createdAt: now });
  }

  console.log(`\nSeed complete. Log in with any of these (password = your SEED_PASSWORD):\n  ${email("nurse.demo")} (admin/nurse)\n  ${email("dr.rao")}, ${email("dr.shetty")}, ... (doctors)\n  ${email("pt.ramesh")}, ${email("pt.lakshmi")}, ... (patients)\n  ${email("cg.ramesh")} (caregiver)  ${email("pharmacy.demo")} (pharmacy)`);
  console.log(`\nDemo 1: as ${email("dr.shetty")} open Ramesh Iyer (on warfarin from Dr. Rao) and prescribe ibuprofen or aspirin -> Major interaction alert.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
