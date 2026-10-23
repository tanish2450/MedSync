import { randomUUID } from "node:crypto";
import type { Route } from "../router.js";
import { requireOpenScan, finishScan } from "./scans.js";
import { badRequest, HttpError, notFound } from "../../lib/http.js";
import { putItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { postFhir } from "../../lib/healthlake.js";
import { allMedRows, assertCanViewPatient, loadActiveMeds, loadDrug, loadPatient, nowIso, runSafetyWorkflow, today } from "../../lib/services.js";
import { unacknowledged } from "../../domain/safety.js";
import { latestByItem, newVersionRow, validateItemInput } from "../../domain/versioning.js";
import { toMedicationRequest } from "../../domain/fhir.js";
import { regenerateDoses } from "../../lib/dosesvc.js";
import type { Alert, PrescriptionItem } from "../../lib/types.js";

async function writeVersion(row: PrescriptionItem, actor: { sub: string; role: string }, action: string, before: unknown) {
  // Immutable rows: conditional put guarantees a version is never overwritten.
  await putItem("PrescriptionItems", row as any, "attribute_not_exists(versionKey)");
  await audit({ actor: actor.sub, actorRole: actor.role, action, entity: `patient#${row.patientId}`, before: before ?? null, after: row });
  void postFhir(toMedicationRequest(row) as any); // best-effort HealthLake sync; DynamoDB is the operational copy
}

const gate = (alerts: Alert[], acks: any) => {
  const missing = unacknowledged(alerts, acks);
  if (missing.length) throw new HttpError(409, "Safety alerts require acknowledgement with a reason", { alerts, missing: missing.map((a) => a.key) });
};

export const medRoutes: Route[] = [
  {
    method: "GET", path: "/patients/:id/medications", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params, query }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      if (query.history === "1") {
        const rows = await allMedRows(patient.id);
        return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // timeline across all doctors
      }
      return loadActiveMeds(patient.id);
    },
  },
  {
    // Dry-run: lets the doctor see alerts before finalising. Save re-runs the same checks server-side.
    method: "POST", path: "/patients/:id/prescriptions/check", roles: ["doctor"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      const ids: string[] = (body.items ?? []).map((i: any) => i.drugId).filter(Boolean);
      if (!ids.length) throw badRequest("Select at least one drug");
      const alerts = await runSafetyWorkflow({ patientId: patient.id, drugIds: ids, excludeItemId: body.excludeItemId });
      return { alerts, noInteractionMessage: "No known interaction found in our database", disclaimer: "Decision support only; does not replace clinical judgement." };
    },
  },
  {
    method: "POST", path: "/patients/:id/prescriptions", roles: ["doctor"], status: 201,
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      // Prescription that came from a patient's photo upload: must be addressed to this doctor and still open
      const scan = body.scanId ? await requireOpenScan(String(body.scanId), caller, patient.id) : null;
      const items: any[] = body.items ?? [];
      if (!items.length) throw badRequest("items required");
      for (const it of items) { const err = validateItemInput(it); if (err) throw badRequest(err); }
      const drugs = await Promise.all(items.map((i) => loadDrug(i.drugId))); // free text not allowed: must exist in catalogue
      for (let i = 0; i < items.length; i++) {
        const forms = drugs[i].forms.find((f) => f.form === items[i].form);
        if (!forms) throw badRequest(`${drugs[i].genericName}: form "${items[i].form}" is not in the catalogue`);
        if (!forms.strengths.includes(items[i].strength)) throw badRequest(`${drugs[i].genericName}: strength "${items[i].strength}" is not in the catalogue`);
      }
      const alerts = await runSafetyWorkflow({ patientId: patient.id, drugIds: items.map((i) => i.drugId) });
      gate(alerts, body.acknowledgements);
      const now = nowIso(); const prescriptionId = randomUUID(); const start = today();
      const actor = { sub: caller.sub, name: caller.name };
      const rows = items.map((it, i) => newVersionRow({
        patientId: patient.id, prescriptionId, itemId: randomUUID(), version: 1, drug: drugs[i], input: it,
        status: "Active", changeType: "created", actor, startDate: start, now,
      }));
      await putItem("Prescriptions", { prescriptionId, patientId: patient.id, doctorId: caller.sub, appointmentId: body.appointmentId ?? null, status: "Final", createdAt: now,
        itemIds: rows.map((r) => r.itemId), acknowledgements: body.acknowledgements ?? [], alertKeys: alerts.map((a) => a.key) });
      for (const [i, r] of rows.entries()) { await writeVersion(r, caller, "prescription.create", null); await regenerateDoses(r, drugs[i]); }
      if (scan) await finishScan(scan, prescriptionId, caller);
      return { prescriptionId, items: rows, alerts };
    },
  },
  {
    method: "POST", path: "/patients/:id/medications/:itemId/modify", roles: ["doctor"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      if (!body.reason?.trim()) throw badRequest("A reason is required to modify a medicine");
      const cur = latestByItem(await allMedRows(patient.id)).find((r) => r.itemId === params.itemId);
      if (!cur) throw notFound("Medication not found");
      if (cur.status === "Discontinued" || cur.status === "Completed") throw badRequest("Cannot modify a discontinued/completed medicine");
      const ch = body.changes ?? {};
      const input = {
        strength: ch.strength ?? cur.strength, form: ch.form ?? cur.form, route: cur.route, dose: ch.dose ?? cur.dose,
        frequency: ch.frequency ?? cur.frequency, // A new frequency without explicit times must NOT inherit the old times, or reminders would keep following the previous schedule
        timings: ch.timings ?? (ch.frequency !== undefined && ch.frequency !== cur.frequency ? undefined : cur.timings),
        durationDays: ch.durationDays ?? cur.durationDays, instructions: ch.instructions ?? cur.instructions,
      };
      const err = validateItemInput({ drugId: cur.drugId, ...input }); if (err) throw badRequest(err);
      const drug = await loadDrug(cur.drugId);
      const alerts = await runSafetyWorkflow({ patientId: patient.id, drugIds: [cur.drugId], excludeItemId: cur.itemId });
      gate(alerts, body.acknowledgements);
      const row = newVersionRow({
        patientId: patient.id, prescriptionId: cur.prescriptionId, itemId: cur.itemId, version: cur.version + 1, drug, input,
        status: "Modified", changeType: "modified", changeReason: body.reason, actor: { sub: caller.sub, name: caller.name }, startDate: cur.startDate, now: nowIso(),
      });
      await writeVersion(row, caller, "medication.modify", cur);
      await regenerateDoses(row, drug);
      return { item: row, alerts };
    },
  },
  {
    method: "POST", path: "/patients/:id/medications/:itemId/discontinue", roles: ["doctor"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      if (!body.reason?.trim()) throw badRequest("A reason is required to discontinue a medicine");
      const cur = latestByItem(await allMedRows(patient.id)).find((r) => r.itemId === params.itemId);
      if (!cur) throw notFound("Medication not found");
      if (cur.status === "Discontinued") throw badRequest("Already discontinued");
      const row: PrescriptionItem = {
        ...cur, version: cur.version + 1, versionKey: `${cur.itemId}#${String(cur.version + 1).padStart(5, "0")}`,
        status: "Discontinued", changeType: "discontinued", changeReason: body.reason, doctorId: caller.sub, doctorName: caller.name,
        createdBy: caller.sub, createdAt: nowIso(),
      };
      await writeVersion(row, caller, "medication.discontinue", cur);
      await regenerateDoses(row, null); // removes future scheduled doses; history of taken/missed stays
      return row;
    },
  },
];
