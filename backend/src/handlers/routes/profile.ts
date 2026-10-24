import { randomUUID } from "node:crypto";
import type { Route } from "../router.js";
import { badRequest, forbidden } from "../../lib/http.js";
import { getItem, putItem, query, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { assertCanViewPatient, loadPatient, nowIso } from "../../lib/services.js";
import { adherenceFor } from "./doses.js";
import type { Appointment } from "../../lib/types.js";

const pick = (o: any, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const PHONE = /^\+[1-9]\d{7,14}$/;
const SELF: Record<string, { users: readonly string[]; record?: readonly string[] }> = {
  patient: { users: ["phone", "language"], record: ["phone", "address", "emergencyContact", "language"] },
  doctor: { users: ["phone"], record: ["phone", "fee", "languages", "qualifications", "experienceYears", "consultationHours", "hospitalPhone"] },
  pharmacy: { users: ["phone"] },
  caregiver: { users: ["phone", "language"] },
  admin_nurse: { users: ["phone"] },
};
const PHARMACY_SELF = ["hours", "phone"] as const;

export const HISTORY_TYPES = ["Diagnosis", "Past illness", "Surgery / procedure", "Hospital visit", "Lab / test result", "Vaccination", "Visit note", "Nursing note"] as const;
const NURSE_TYPES = ["Visit note", "Nursing note"];

export const profileRoutes: Route[] = [
  {
    method: "GET", path: "/profile", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy", "lab"],
    async handler({ caller }) {
      const user = await getItem<any>("Users", { id: caller.sub });
      let record: any = null; let pharmacy: any = null;
      if (caller.role === "patient") record = await getItem("Patients", { id: caller.sub });
      else if (caller.role === "doctor") record = await getItem("Doctors", { id: caller.sub });
      else if (caller.role === "pharmacy" && user?.pharmacyId) pharmacy = await getItem("Pharmacies", { id: user.pharmacyId });
      return { role: caller.role, email: caller.email, name: caller.name, user, record, pharmacy };
    },
  },
  {
    method: "PUT", path: "/profile", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy", "lab"],
    async handler({ caller, body }) {
      const rules = SELF[caller.role];
      const userPatch = pick(body, rules.users);
      const recPatch = rules.record ? pick(body, rules.record) : {};
      const pharmPatch = caller.role === "pharmacy" && body.pharmacy ? pick(body.pharmacy, PHARMACY_SELF) : {};
      for (const k of ["phone", "hospitalPhone"]) {
        const v = (userPatch as any)[k] ?? (recPatch as any)[k] ?? (pharmPatch as any)[k];
        if (v !== undefined && !PHONE.test(String(v).replace(/[\s-]/g, ""))) throw badRequest("Phone must be in international format, e.g. +919876543210");
      }
      if ((recPatch as any).fee !== undefined && !(Number((recPatch as any).fee) >= 0)) throw badRequest("Fee must be a number");
      if (!Object.keys(userPatch).length && !Object.keys(recPatch).length && !Object.keys(pharmPatch).length) throw badRequest("Nothing to update");
      const now = nowIso();
      if (Object.keys(userPatch).length) await updateItem("Users", { id: caller.sub }, userPatch);
      if (Object.keys(recPatch).length) {
        const table = caller.role === "patient" ? "Patients" : "Doctors";
        await updateItem(table, { id: caller.sub }, caller.role === "patient" ? { ...recPatch, updatedAt: now } : recPatch);
      }
      if (Object.keys(pharmPatch).length) {
        const u = await getItem<any>("Users", { id: caller.sub });
        if (u?.pharmacyId) await updateItem("Pharmacies", { id: u.pharmacyId }, pharmPatch);
      }
      await audit({ actor: caller.sub, actorRole: caller.role, action: "profile.update", entity: `${caller.role}#${caller.sub}`, after: { ...userPatch, ...recPatch, ...pharmPatch } });
      return { ok: true };
    },
  },
  {
    // Full longitudinal view for the treating team. Doctors only see appointments THEY had with the patient.
    method: "GET", path: "/patients/:id/history", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      const [entries, appts, adherence] = await Promise.all([
        query<any>("MedicalHistory", { pk: "patientId", pkValue: patient.id, forward: false }),
        query<Appointment>("Appointments", { index: "byPatient", pk: "patientId", pkValue: patient.id }),
        caller.role === "patient" ? Promise.resolve(null) : adherenceFor(patient.id, 30),
      ]);
      const visible = caller.role === "doctor" ? appts.filter((a) => a.doctorId === caller.sub) : appts;
      return {
        entries,
        appointments: visible.sort((a, b) => b.slotStart.localeCompare(a.slotStart)),
        adherence30: adherence,
        types: caller.role === "doctor" ? HISTORY_TYPES : NURSE_TYPES,
      };
    },
  },
  {
    method: "POST", path: "/patients/:id/history", roles: ["doctor", "admin_nurse"], status: 201,
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      const allowed: readonly string[] = caller.role === "doctor" ? HISTORY_TYPES : NURSE_TYPES;
      if (!allowed.includes(body.type)) throw caller.role === "doctor" ? badRequest("Choose a valid entry type") : forbidden("Nurses can add visit or nursing notes only");
      const title = String(body.title ?? "").trim(); const notes = String(body.notes ?? "").trim();
      if (title.length < 3 || title.length > 150) throw badRequest("Title must be 3–150 characters");
      if (notes.length > 3000) throw badRequest("Notes are too long (max 3000 characters)");
      const date = String(body.date ?? nowIso().slice(0, 10));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > nowIso().slice(0, 10)) throw badRequest("Date must be YYYY-MM-DD and not in the future");
      const entry = { patientId: patient.id, entryKey: `${date}#${randomUUID()}`, date, type: body.type, title, notes, addedBy: caller.sub, addedByName: caller.name, addedByRole: caller.role, createdAt: nowIso() };
      await putItem("MedicalHistory", entry);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "history.add", entity: `patient#${patient.id}`, after: { type: entry.type, title } });
      return entry;
    },
  },
];
