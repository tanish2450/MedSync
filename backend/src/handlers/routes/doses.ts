import type { Route } from "../router.js";
import { badRequest, forbidden, notFound } from "../../lib/http.js";
import { getItem, scan, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { assertCanViewPatient, loadPatient, nowIso } from "../../lib/services.js";
import { dosesBetween } from "../../lib/dosesvc.js";
import { recordDoseMetric } from "../../lib/timestream.js";
import { computeAdherence, istDate } from "../../domain/doses.js";
import { addDays } from "../../domain/versioning.js";
import type { DoseEvent, Patient } from "../../lib/types.js";

const dateOk = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function adherenceFor(patientId: string, days = 7, now = new Date()) {
  const to = istDate(now);
  return computeAdherence(await dosesBetween(patientId, addDays(to, -(days - 1)), to), now);
}

export const doseRoutes: Route[] = [
  {
    method: "GET", path: "/patients/:id/doses", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params, query: q }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      const date = dateOk(q.date) ? q.date : istDate(new Date());
      return { date, doses: await dosesBetween(patient.id, date, date) };
    },
  },
  {
    // Patient or linked caregiver taps Taken / Skip. Only still-scheduled doses can be marked (Missed is final).
    method: "POST", path: "/patients/:id/doses/mark", roles: ["patient", "caregiver"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      if (caller.role === "patient" && patient.id !== caller.sub) throw forbidden();
      if (caller.role === "caregiver") {
        const link = await getItem<{ status: string; permissions?: string[] }>("CaregiverLinks", { patientId: patient.id, caregiverId: caller.sub });
        if (link?.status !== "Active" || !link.permissions?.includes("mark-dose")) throw forbidden("Not permitted to mark doses for this patient");
      }
      if (!["Taken", "Skipped"].includes(body.status)) throw badRequest("status must be Taken or Skipped");
      if (body.status === "Skipped" && !body.reason?.trim()) throw badRequest("A reason is required when skipping a dose");
      const cur = await getItem<DoseEvent>("DoseEvents", { patientId: patient.id, doseKey: body.doseKey });
      if (!cur) throw notFound("Dose not found");
      if (cur.status !== "Scheduled") throw badRequest(`This dose is already ${cur.status}`);
      const confirmedAt = nowIso();
      try {
        await updateItem("DoseEvents", { patientId: patient.id, doseKey: body.doseKey },
          { status: body.status, confirmedAt, confirmedBy: caller.sub, skipReason: body.reason },
          { expr: "#st = :sc", names: { "#st": "status" }, values: { ":sc": "Scheduled" } });
      } catch (e: any) {
        if (e?.name === "ConditionalCheckFailedException") throw badRequest("This dose was just updated; refresh and retry");
        throw e;
      }
      await audit({ actor: caller.sub, actorRole: caller.role, action: `dose.${String(body.status).toLowerCase()}`, entity: `patient#${patient.id}`, before: cur, after: { ...cur, status: body.status, confirmedAt } });
      void recordDoseMetric({ patientId: patient.id, drugId: cur.drugId, status: body.status, time: new Date(cur.scheduledTime) });
      return { ...cur, status: body.status, confirmedAt, confirmedBy: caller.sub };
    },
  },
  {
    method: "GET", path: "/patients/:id/adherence", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params, query: q }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      return adherenceFor(patient.id, Math.min(Math.max(Number(q.days ?? 7), 1), 90));
    },
  },
  {
    // Patients needing attention: shown on admin overview (read-only) and doctor dashboard flags
    method: "GET", path: "/adherence/low", roles: ["admin_nurse", "doctor"],
    async handler({ caller }) {
      let pts = await scan<Patient>("Patients");
      if (caller.role === "doctor") pts = pts.filter((p) => p.assignedDoctors?.includes(caller.sub));
      const rows = await Promise.all(pts.map(async (p) => ({ patientId: p.id, name: p.name, adherence: await adherenceFor(p.id, 7) })));
      return rows.filter((r) => r.adherence.percent !== null && r.adherence.due >= 4 && r.adherence.percent < 70)
        .map((r) => ({ patientId: r.patientId, name: r.name, percent: r.adherence.percent, missed: r.adherence.missed }));
    },
  },
];
