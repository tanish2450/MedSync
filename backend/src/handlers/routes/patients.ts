import { reminderTimes } from "../../domain/doses.js";
import type { Route } from "../router.js";
import { badRequest, forbidden } from "../../lib/http.js";
import { getItem, putItem, query, scan, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { createCognitoUser } from "../../lib/cognito.js";
import { assertCanViewPatient, loadActiveMeds, loadPatient, nowIso } from "../../lib/services.js";
import { can } from "../../domain/permissions.js";
import { adherenceFor } from "./doses.js";
import type { Insurance, Patient } from "../../lib/types.js";

const DEMOGRAPHIC = ["name", "phone", "dob", "gender", "address", "bloodGroup", "language", "emergencyContact", "assignedDoctors", "active"] as const;
const PATIENT_SELF = ["phone", "address", "emergencyContact", "language"] as const;
const CLINICAL = ["allergies", "conditions"] as const;

const pick = (o: any, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const isEmail = (s: unknown): s is string => typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export const maskPolicy = (p?: string) => (p && p.length > 4 ? `${"•".repeat(p.length - 4)}${p.slice(-4)}` : p);

export const patientRoutes: Route[] = [
  {
    method: "POST", path: "/patients", roles: ["admin_nurse"], status: 201,
    async handler({ caller, body }) {
      if (!body.name?.trim()) throw badRequest("name is required");
      if (!isEmail(body.email)) throw badRequest("A valid email is required");
      const clinical = Object.keys(pick(body, CLINICAL));
      if (clinical.length) throw forbidden("Admin/Nurse cannot set clinical content (allergies/conditions)");
      const id = await createCognitoUser({ email: body.email, name: body.name, role: "patient" });
      const now = nowIso();
      const patient: Patient = {
        id, email: body.email, name: body.name, ...pick(body, DEMOGRAPHIC), assignedDoctors: body.assignedDoctors ?? [],
        allergies: [], conditions: [], active: true, createdAt: now, updatedAt: now,
      } as Patient;
      await putItem("Patients", patient as any);
      await putItem("Users", { id, role: "patient", name: body.name, email: body.email, language: body.language ?? "en", status: "active" });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "patient.create", entity: `patient#${id}`, after: patient });
      return patient;
    },
  },
  {
    method: "GET", path: "/patients", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, query: q }) {
      let list: Patient[];
      if (caller.role === "admin_nurse") list = await scan<Patient>("Patients");
      else if (caller.role === "doctor") list = (await scan<Patient>("Patients")).filter((p) => p.assignedDoctors?.includes(caller.sub));
      else if (caller.role === "patient") { const p = await getItem<Patient>("Patients", { id: caller.sub }); list = p ? [p] : []; }
      else {
        const links = await query<{ patientId: string; status: string }>("CaregiverLinks", { index: "byCaregiver", pk: "caregiverId", pkValue: caller.sub });
        const ps = await Promise.all(links.filter((l) => l.status === "Active").map((l) => getItem<Patient>("Patients", { id: l.patientId })));
        list = ps.filter(Boolean) as Patient[];
      }
      const term = q.q?.toLowerCase();
      if (term) list = list.filter((p) => [p.name, p.email, p.phone].some((v) => v?.toLowerCase().includes(term)));
      list = list.sort((a, b) => a.name.localeCompare(b.name));
      return Promise.all(list.map(async (p) => {
        const flags: Record<string, unknown> = { allergies: p.allergies?.length ?? 0 };
        if (caller.role === "doctor") { const a = await adherenceFor(p.id, 7); flags.adherence = a.percent; flags.lowAdherence = a.percent !== null && a.due >= 4 && a.percent < 70; }
        return { ...p, flags };
      }));
    },
  },
  {
    // Read-only record: demographics + current medicines + allergies/conditions + insurance
    method: "GET", path: "/patients/:id", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      const [medications, insurance] = await Promise.all([loadActiveMeds(patient.id), getItem<Insurance>("Insurance", { patientId: patient.id })]);
      const ins = insurance && caller.role !== "admin_nurse" ? { ...insurance, policyNo: maskPolicy(insurance.policyNo) } : insurance;
      return { patient, medications: medications.map((m) => ({ ...m, reminderTimes: reminderTimes(m.frequency, m.timings) })), insurance: ins ?? null, readOnly: caller.role !== "doctor" };
    },
  },
  {
    method: "PUT", path: "/patients/:id", roles: ["admin_nurse", "patient"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      const attemptedClinical = Object.keys(pick(body, CLINICAL));
      if (attemptedClinical.length) {
        await audit({ actor: caller.sub, actorRole: caller.role, action: "patient.clinical.update", entity: `patient#${patient.id}`, outcome: "denied", meta: { fields: attemptedClinical } });
        throw forbidden("Clinical content can only be edited by the treating doctor");
      }
      let patch: Record<string, unknown>;
      if (caller.role === "admin_nurse" && can(caller.role, "patient.manage")) patch = pick(body, DEMOGRAPHIC);
      else if (caller.role === "patient" && patient.id === caller.sub) patch = pick(body, PATIENT_SELF);
      else throw forbidden();
      if (!Object.keys(patch).length) throw badRequest("No editable fields supplied");
      if (patch.assignedDoctors && !Array.isArray(patch.assignedDoctors)) throw badRequest("assignedDoctors must be an array");
      const updatedAt = nowIso();
      await updateItem("Patients", { id: patient.id }, { ...patch, updatedAt });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "patient.update", entity: `patient#${patient.id}`, before: pick(patient, Object.keys(patch)), after: patch });
      return { ...patient, ...patch, updatedAt };
    },
  },
  {
    // Treating doctor maintains allergies and conditions (clinical content)
    method: "PUT", path: "/patients/:id/clinical", roles: ["doctor", "patient", "caregiver"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      // Patients and their linked caregivers may keep ALLERGIES up to date; conditions stay with the treating doctor.
      if (caller.role !== "doctor" && body.conditions !== undefined) throw forbidden("Only a doctor can change conditions");
      const patch = pick(body, caller.role === "doctor" ? CLINICAL : ["allergies"]);
      if (patch.allergies && !Array.isArray(patch.allergies)) throw badRequest("allergies must be an array");
      if (patch.allergies) {
        const seen = new Set<string>();
        patch.allergies = (patch.allergies as any[]).filter((a) => a && typeof a.substance === "string" && a.substance.trim()).slice(0, 50).map((a) => ({
          substance: a.substance.trim().slice(0, 100), reaction: typeof a.reaction === "string" && a.reaction.trim() ? a.reaction.trim().slice(0, 200) : undefined,
          severity: typeof a.severity === "string" ? a.severity.slice(0, 30) : undefined,
        })).filter((a) => { const k = a.substance.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      }
      if (!Object.keys(patch).length) throw badRequest("Provide allergies and/or conditions");
      await updateItem("Patients", { id: patient.id }, { ...patch, updatedAt: nowIso() });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "patient.clinical.update", entity: `patient#${patient.id}`, before: pick(patient, Object.keys(patch)), after: patch });
      return { ...patient, ...patch };
    },
  },
  {
    method: "GET", path: "/patients/:id/audit", roles: ["admin_nurse", "doctor"],
    async handler({ caller, params }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      return query("AuditEvents", { pk: "entity", pkValue: `patient#${patient.id}`, forward: false, limit: 200 });
    },
  },
];
