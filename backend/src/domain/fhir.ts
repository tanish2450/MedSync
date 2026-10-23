import type { PrescriptionItem, Allergy } from "../lib/types.js";

const statusMap: Record<string, string> = { Active: "active", Modified: "active", Discontinued: "stopped", Completed: "completed" };

/** Map an immutable prescription version row to FHIR R4 MedicationRequest (+ meta for version history). */
export function toMedicationRequest(r: PrescriptionItem) {
  return {
    resourceType: "MedicationRequest",
    identifier: [{ system: "urn:medsync:prescription-item", value: r.itemId }, { system: "urn:medsync:version", value: String(r.version) }],
    status: statusMap[r.status] ?? "unknown",
    intent: "order",
    medicationCodeableConcept: { text: `${r.drugName} ${r.strength} ${r.form}` },
    subject: { reference: `Patient/${r.patientId}` },
    authoredOn: r.createdAt,
    requester: { display: r.doctorName, reference: `Practitioner/${r.doctorId}` },
    dosageInstruction: [{
      text: `${r.dose}, ${r.frequency}${r.instructions ? `. ${r.instructions}` : ""}`,
      route: { text: r.route },
      timing: { repeat: { boundsDuration: { value: r.durationDays, unit: "d", system: "http://unitsofmeasure.org", code: "d" } } },
    }],
    dispenseRequest: { validityPeriod: { start: r.startDate, end: r.endDate } },
    note: r.changeReason ? [{ text: `v${r.version} ${r.changeType}: ${r.changeReason}` }] : undefined,
  };
}

export function toAllergyIntolerance(patientId: string, a: Allergy) {
  return {
    resourceType: "AllergyIntolerance",
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
    code: { text: a.substance },
    patient: { reference: `Patient/${patientId}` },
    reaction: a.reaction ? [{ manifestation: [{ text: a.reaction }] }] : undefined,
  };
}
