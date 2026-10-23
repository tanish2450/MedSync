// Single source of truth for DynamoDB table definitions (used by CDK and by Lambda env wiring).
export interface GsiDef { name: string; pk: string; sk?: string }
export interface TableDef { key: string; pk: string; sk?: string; gsis?: GsiDef[] }

export const TABLES = {
  Users: { key: "Users", pk: "id", gsis: [{ name: "byEmail", pk: "email" }, { name: "byRole", pk: "role" }] },
  Patients: { key: "Patients", pk: "id" },
  Doctors: { key: "Doctors", pk: "id" },
  Pharmacies: { key: "Pharmacies", pk: "id" },
  CaregiverLinks: { key: "CaregiverLinks", pk: "patientId", sk: "caregiverId", gsis: [{ name: "byCaregiver", pk: "caregiverId", sk: "patientId" }] },
  DrugCatalogue: { key: "DrugCatalogue", pk: "drugId" },
  DrugInteractions: { key: "DrugInteractions", pk: "pairKey" },
  // Immutable version rows: pk=patientId, sk=`${itemId}#${version padded}`
  PrescriptionItems: { key: "PrescriptionItems", pk: "patientId", sk: "versionKey" },
  Prescriptions: { key: "Prescriptions", pk: "prescriptionId", gsis: [{ name: "byPatient", pk: "patientId", sk: "createdAt" }] },
  Appointments: {
    key: "Appointments", pk: "id",
    gsis: [
      { name: "byPatient", pk: "patientId", sk: "slotStart" },
      { name: "byDoctor", pk: "doctorId", sk: "slotStart" },
    ],
  },
  // Conditional-put lock per doctor slot => no double booking
  SlotLocks: { key: "SlotLocks", pk: "doctorId", sk: "slotStart" },
  Insurance: { key: "Insurance", pk: "patientId" },
  InsuranceHistory: { key: "InsuranceHistory", pk: "patientId", sk: "ts" },
  // One row per scheduled dose. GSI byStatus lets the scheduler find due/overdue doses without scanning.
  DoseEvents: { key: "DoseEvents", pk: "patientId", sk: "doseKey", gsis: [{ name: "byStatus", pk: "status", sk: "scheduledTime" }] },
  // Append-only longitudinal record (diagnoses, procedures, results, notes): pk=patientId, sk=`${date}#${uuid}`
  MedicalHistory: { key: "MedicalHistory", pk: "patientId", sk: "entryKey" },
  // Patient-uploaded prescription photos awaiting doctor review
  PrescriptionScans: { key: "PrescriptionScans", pk: "id", gsis: [{ name: "byPatient", pk: "patientId", sk: "createdAt" }, { name: "byDoctor", pk: "doctorId", sk: "createdAt" }] },
  // Medicine orders from patients/caregivers to pharmacies
  Orders: { key: "Orders", pk: "id", gsis: [{ name: "byPatient", pk: "patientId", sk: "createdAt" }, { name: "byPharmacy", pk: "pharmacyId", sk: "createdAt" }] },
  Notifications: { key: "Notifications", pk: "userId", sk: "id" },
  ConfirmationTasks: { key: "ConfirmationTasks", pk: "appointmentId", gsis: [{ name: "byDoctor", pk: "doctorId", sk: "slotStart" }] },
  // Append-only audit trail: pk=entity ("patient#<id>"), sk=`${ts}#${uuid}`
  AuditEvents: { key: "AuditEvents", pk: "entity", sk: "eventKey" },
} as const satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
export const tableEnvVar = (t: string) => `TABLE_${t.toUpperCase()}`;
