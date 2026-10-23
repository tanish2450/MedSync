import { randomUUID } from "node:crypto";
import type { Route } from "../router.js";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/http.js";
import { getItem, putItem, query, scan, transact, tn, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { createCognitoUser } from "../../lib/cognito.js";
import { loadPatient, nowIso } from "../../lib/services.js";
import { deleteItem } from "../../lib/db.js";
import { nextSlotsFor } from "../../lib/slotsvc.js";
import { generateSlots, isConfiguredSlot } from "../../domain/slots.js";
import { addDays } from "../../domain/versioning.js";
import type { Appointment, Availability, Doctor } from "../../lib/types.js";

const DEFAULT_AV: Availability = { slotMinutes: 30, weeklyHours: {}, breaks: [], leaveDates: [] };
const DOCTOR_FIELDS = ["name", "specialty", "registrationNo", "qualifications", "languages", "fee", "clinic", "consultationHours", "active", "verified", "hospitalName", "hospitalAddress", "hospitalCity", "hospitalPhone", "experienceYears", "registrationCouncil"] as const;
const pick = (o: any, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const dateOk = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function loadDoctor(id: string) { const d = await getItem<Doctor>("Doctors", { id }); if (!d) throw notFound("Doctor not found"); return d; }
async function loadAppt(id: string) { const a = await getItem<Appointment>("Appointments", { id }); if (!a) throw notFound("Appointment not found"); return a; }

async function bookedStarts(doctorId: string, from: string, to: string): Promise<Set<string>> {
  const locks = await query<{ slotStart: string }>("SlotLocks", { pk: "doctorId", pkValue: doctorId, skName: "slotStart", skBetween: [from, to] });
  return new Set(locks.map((l) => l.slotStart));
}

const conflict = (e: any) => e?.name === "TransactionCanceledException" || e?.name === "ConditionalCheckFailedException";

function assertCanTouch(caller: { role: string; sub: string }, a: Appointment) {
  const ok = caller.role === "admin_nurse" || (caller.role === "doctor" && a.doctorId === caller.sub) || (caller.role === "patient" && a.patientId === caller.sub);
  if (!ok) throw forbidden();
}

export const schedulingRoutes: Route[] = [
  {
    method: "GET", path: "/doctors", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, query: q }) {
      let list = await scan<Doctor>("Doctors");
      if (caller.role !== "admin_nurse") list = list.filter((d) => d.active);
      if (q.specialty) list = list.filter((d) => d.specialty.toLowerCase() === q.specialty.toLowerCase());
      if (q.language) list = list.filter((d) => d.languages?.some((l) => l.toLowerCase() === q.language.toLowerCase()));
      if (q.maxFee) list = list.filter((d) => d.fee <= Number(q.maxFee));
      if (q.q) list = list.filter((d) => `${d.name} ${d.specialty} ${d.clinic?.name}`.toLowerCase().includes(q.q.toLowerCase()));
      list = list.sort((a, b) => a.name.localeCompare(b.name));
      if (q.slots === "1") return Promise.all(list.map(async (d) => ({ ...d, nextSlots: await nextSlotsFor(d, 7, 6) })));
      return list;
    },
  },
  {
    method: "POST", path: "/doctors", roles: ["admin_nurse"], status: 201,
    async handler({ caller, body }) {
      for (const f of ["name", "email", "specialty", "registrationNo"]) if (!body[f]?.trim?.()) throw badRequest(`${f} is required`);
      if (!body.clinic?.name || typeof body.clinic.lat !== "number" || typeof body.clinic.lng !== "number") throw badRequest("clinic {name,address,lat,lng} is required");
      const id = await createCognitoUser({ email: body.email, name: body.name, role: "doctor" });
      const doctor: Doctor = {
        id, email: body.email, ...(pick(body, DOCTOR_FIELDS) as any), languages: body.languages ?? ["English"], fee: Number(body.fee ?? 0),
        availability: { ...DEFAULT_AV, ...(body.availability ?? {}) }, onlineStatus: "Offline", active: true, googleCalendarConnected: false,
      };
      await putItem("Doctors", doctor as any);
      await putItem("Users", { id, role: "doctor", name: body.name, email: body.email, language: "en", status: "active" });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "doctor.create", entity: `doctor#${id}`, after: doctor });
      return doctor;
    },
  },
  {
    method: "GET", path: "/doctors/:id", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    handler: async ({ params }) => loadDoctor(params.id),
  },
  {
    method: "PUT", path: "/doctors/:id", roles: ["admin_nurse", "doctor"],
    async handler({ caller, params, body }) {
      const d = await loadDoctor(params.id);
      let patch: Record<string, unknown>;
      if (caller.role === "admin_nurse") patch = pick(body, DOCTOR_FIELDS);
      else if (d.id === caller.sub) {
        patch = pick(body, ["availability", "onlineStatus"]);
        if (patch.onlineStatus && !["Available", "Busy", "Offline"].includes(patch.onlineStatus as string)) throw badRequest("Invalid onlineStatus");
      } else throw forbidden();
      if (patch.availability) {
        const av = patch.availability as Availability;
        if (!av.slotMinutes || av.slotMinutes < 5 || av.slotMinutes > 120 || typeof av.weeklyHours !== "object") throw badRequest("Invalid availability");
        patch.availability = { ...DEFAULT_AV, ...av };
      }
      if (!Object.keys(patch).length) throw badRequest("No editable fields supplied");
      await updateItem("Doctors", { id: d.id }, patch);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "doctor.update", entity: `doctor#${d.id}`, before: pick(d, Object.keys(patch)), after: patch });
      return { ...d, ...patch };
    },
  },
  {
    // Slots = configured availability − breaks − leave − already booked. `date` + `days` (default 1, max 14)
    method: "GET", path: "/doctors/:id/slots", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ params, query: q }) {
      if (!dateOk(q.date)) throw badRequest("date=YYYY-MM-DD required");
      const days = Math.min(Math.max(Number(q.days ?? 1), 1), 14);
      const d = await loadDoctor(params.id);
      if (!d.active) return [];
      const last = addDays(q.date, days - 1);
      const booked = await bookedStarts(d.id, `${q.date}T00:00:00+05:30`, `${last}T23:59:59+05:30`);
      const out: { start: string; end: string }[] = [];
      for (let i = 0; i < days; i++) out.push(...generateSlots(d.availability, addDays(q.date, i), booked));
      return out;
    },
  },
  {
    method: "POST", path: "/appointments", roles: ["patient", "admin_nurse"], status: 201,
    async handler({ caller, body }) {
      const patientId = caller.role === "patient" ? caller.sub : body.patientId;
      if (!patientId) throw badRequest("patientId required");
      if (!body.doctorId || !body.slotStart) throw badRequest("doctorId and slotStart required");
      const [patient, doctor] = await Promise.all([loadPatient(patientId), loadDoctor(body.doctorId)]);
      if (!doctor.active) throw badRequest("Doctor is not active");
      if (new Date(body.slotStart).getTime() <= Date.now()) throw badRequest("Slot is in the past");
      if (!isConfiguredSlot(doctor.availability, body.slotStart)) throw badRequest("Not an available slot for this doctor");
      const slotEnd = new Date(new Date(body.slotStart).getTime() + doctor.availability.slotMinutes * 60000);
      const end = new Date(slotEnd.getTime() + 5.5 * 3600_000).toISOString().replace("Z", "+05:30").replace(/\.\d{3}/, "");
      const now = nowIso();
      const appt: Appointment = {
        id: randomUUID(), patientId, patientName: patient.name, doctorId: doctor.id, doctorName: doctor.name,
        slotStart: body.slotStart, slotEnd: end, status: "Booked", confirmationStatus: "None", reason: body.reason,
        createdBy: caller.sub, createdAt: now, updatedAt: now,
      };
      try {
        await transact([
          { Put: { TableName: tn("SlotLocks"), Item: { doctorId: doctor.id, slotStart: body.slotStart, appointmentId: appt.id }, ConditionExpression: "attribute_not_exists(doctorId)" } },
          { Put: { TableName: tn("Appointments"), Item: appt } },
        ]);
      } catch (e) {
        if (conflict(e)) throw new HttpError(409, "That slot has just been booked. Please choose another.");
        throw e;
      }
      if (!patient.assignedDoctors?.includes(doctor.id)) await updateItem("Patients", { id: patient.id }, { assignedDoctors: [...(patient.assignedDoctors ?? []), doctor.id], updatedAt: now });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "appointment.book", entity: `patient#${patient.id}`, after: appt });
      return appt;
    },
  },
  {
    method: "GET", path: "/appointments", roles: ["admin_nurse", "doctor", "patient"],
    async handler({ caller, query: q }) {
      let list: Appointment[];
      if (caller.role === "admin_nurse") list = await scan<Appointment>("Appointments");
      else if (caller.role === "doctor") list = await query<Appointment>("Appointments", { index: "byDoctor", pk: "doctorId", pkValue: caller.sub });
      else list = await query<Appointment>("Appointments", { index: "byPatient", pk: "patientId", pkValue: caller.sub });
      // A doctor must only ever see appointments booked WITH them, never the patient's visits to other doctors
      if (caller.role === "doctor") list = list.filter((a) => a.doctorId === caller.sub);
      if (caller.role === "patient") list = list.filter((a) => a.patientId === caller.sub);
      if (q.from) list = list.filter((a) => a.slotStart >= q.from);
      if (q.to) list = list.filter((a) => a.slotStart <= q.to);
      if (q.status) list = list.filter((a) => a.status === q.status);
      return list.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
    },
  },
  {
    method: "POST", path: "/appointments/:id/cancel", roles: ["patient", "admin_nurse", "doctor"],
    async handler({ caller, params }) {
      const a = await loadAppt(params.id); assertCanTouch(caller, a);
      if (a.status !== "Booked") throw badRequest(`Appointment is already ${a.status}`);
      const now = nowIso();
      try {
        await transact([
          { Delete: { TableName: tn("SlotLocks"), Key: { doctorId: a.doctorId, slotStart: a.slotStart } } },
          { Update: { TableName: tn("Appointments"), Key: { id: a.id }, UpdateExpression: "SET #s = :c, updatedAt = :u", ConditionExpression: "#s = :b",
            ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":c": "Cancelled", ":b": "Booked", ":u": now } } },
        ]);
      } catch (e) { if (conflict(e)) throw new HttpError(409, "Appointment changed; refresh and retry"); throw e; }
      await deleteItem("ConfirmationTasks", { appointmentId: a.id });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "appointment.cancel", entity: `patient#${a.patientId}`, before: a, after: { ...a, status: "Cancelled" } });
      return { ...a, status: "Cancelled", updatedAt: now };
    },
  },
  {
    method: "POST", path: "/appointments/:id/reschedule", roles: ["patient", "admin_nurse", "doctor"],
    async handler({ caller, params, body }) {
      const a = await loadAppt(params.id); assertCanTouch(caller, a);
      if (a.status !== "Booked") throw badRequest(`Appointment is already ${a.status}`);
      if (!body.slotStart) throw badRequest("slotStart required");
      const doctor = await loadDoctor(a.doctorId);
      if (new Date(body.slotStart).getTime() <= Date.now()) throw badRequest("Slot is in the past");
      if (!isConfiguredSlot(doctor.availability, body.slotStart)) throw badRequest("Not an available slot for this doctor");
      const end = new Date(new Date(body.slotStart).getTime() + doctor.availability.slotMinutes * 60000 + 5.5 * 3600_000).toISOString().replace("Z", "+05:30").replace(/\.\d{3}/, "");
      const now = nowIso();
      try {
        await transact([
          { Put: { TableName: tn("SlotLocks"), Item: { doctorId: a.doctorId, slotStart: body.slotStart, appointmentId: a.id }, ConditionExpression: "attribute_not_exists(doctorId)" } },
          { Delete: { TableName: tn("SlotLocks"), Key: { doctorId: a.doctorId, slotStart: a.slotStart } } },
          { Update: { TableName: tn("Appointments"), Key: { id: a.id }, UpdateExpression: "SET slotStart = :s, slotEnd = :e, updatedAt = :u, confirmationStatus = :n",
            ConditionExpression: "#st = :b", ExpressionAttributeNames: { "#st": "status" }, ExpressionAttributeValues: { ":s": body.slotStart, ":e": end, ":u": now, ":b": "Booked", ":n": "None" } } },
        ]);
      } catch (e) { if (conflict(e)) throw new HttpError(409, "That slot has just been booked. Please choose another."); throw e; }
      await deleteItem("ConfirmationTasks", { appointmentId: a.id });
      const after = { ...a, slotStart: body.slotStart, slotEnd: end, updatedAt: now };
      await audit({ actor: caller.sub, actorRole: caller.role, action: "appointment.reschedule", entity: `patient#${a.patientId}`, before: a, after });
      return after;
    },
  },
];
