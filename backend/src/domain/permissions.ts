import type { Role } from "../lib/types.js";

/** Capability matrix from the spec (Section 3). Enforced on the backend for every route. */
export type Capability =
  | "patient.manage" | "patient.editOwnContact" | "patient.viewRecord"
  | "medicine.edit" | "appointment.manage" | "appointment.bookOwn"
  | "insurance.update" | "insurance.view" | "doctor.manage" | "pharmacy.manage"
  | "caregiver.manage";

const MATRIX: Record<Capability, Role[]> = {
  "patient.manage": ["admin_nurse"],
  "patient.editOwnContact": ["patient"],
  "patient.viewRecord": ["admin_nurse", "doctor", "patient", "caregiver"],
  "medicine.edit": ["doctor"],
  "appointment.manage": ["admin_nurse", "doctor"],
  "appointment.bookOwn": ["patient"],
  "insurance.update": ["admin_nurse"],
  "insurance.view": ["admin_nurse", "doctor", "patient", "caregiver"],
  "doctor.manage": ["admin_nurse"],
  "pharmacy.manage": ["admin_nurse"],
  "caregiver.manage": ["patient"],
};

export const can = (role: Role, cap: Capability) => MATRIX[cap].includes(role);

export interface PatientAccessCtx {
  role: Role; sub: string;
  patient: { id: string; assignedDoctors: string[] };
  caregiverLinkActive?: boolean;
}

/** Ownership rules: doctor only assigned patients, patient only self, caregiver only linked patient. */
export function canViewPatient(c: PatientAccessCtx): boolean {
  switch (c.role) {
    case "admin_nurse": return true;
    case "doctor": return c.patient.assignedDoctors.includes(c.sub);
    case "patient": return c.patient.id === c.sub;
    case "caregiver": return !!c.caregiverLinkActive;
    default: return false;
  }
}
