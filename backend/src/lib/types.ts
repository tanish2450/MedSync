export type Role = "admin_nurse" | "doctor" | "patient" | "caregiver" | "pharmacy";
export const ROLES: Role[] = ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy"];

export type Severity = "Minor" | "Moderate" | "Major" | "Contraindicated";
export type MedStatus = "Active" | "Modified" | "Discontinued" | "Completed";

export interface Allergy { substance: string; reaction?: string; severity?: string }

export interface Patient {
  id: string; name: string; email: string; phone?: string; dob?: string; gender?: string;
  address?: string; bloodGroup?: string; language?: string;
  emergencyContact?: { name: string; phone: string; relation?: string };
  /** Patient-raised emergency: puts their conversations first and alerts the care team. */
  emergency?: { active: boolean; since?: string; note?: string; raisedBy?: string; clearedAt?: string; clearedBy?: string };
  assignedDoctors: string[];
  allergies: Allergy[];
  conditions: string[];
  active: boolean;
  createdAt: string; updatedAt: string;
}

export interface WeeklyHours { [day: string]: { start: string; end: string }[] }
export interface Availability {
  slotMinutes: number;
  weeklyHours: WeeklyHours;           // keys: mon..sun, times "HH:mm" IST
  breaks: { start: string; end: string }[];
  leaveDates: string[];               // YYYY-MM-DD
}
export interface Doctor {
  id: string; name: string; email: string; phone?: string; specialty: string; registrationNo: string;
  qualifications?: string; languages: string[]; fee: number;
  clinic: { name: string; address: string; lat: number; lng: number };
  consultationHours?: string; availability: Availability;
  onlineStatus: "Available" | "Busy" | "Offline";
  active: boolean; googleCalendarConnected: boolean;
}

export interface Drug {
  drugId: string; genericName: string; ingredients: string[]; classes: string[];
  brandNames: string[]; forms: { form: string; strengths: string[] }[];
  criticalDrug?: boolean; rxnormId?: string;
}
export interface InteractionRecord {
  pairKey: string; ingredientA: string; ingredientB: string; severity: Severity;
  mechanism: string; effect: string; recommendation: string; source: string;
}

export interface PrescriptionItem {
  patientId: string; versionKey: string; itemId: string; version: number;
  prescriptionId: string; drugId: string; drugName: string; ingredients: string[]; classes: string[];
  strength: string; form: string; route: string; dose: string; frequency: string;
  timings?: string[]; durationDays: number; instructions?: string;
  startDate: string; endDate: string;
  status: MedStatus; doctorId: string; doctorName: string;
  changeReason?: string; changeType: "created" | "modified" | "discontinued" | "completed";
  createdBy: string; createdAt: string;
}

export interface Appointment {
  id: string; patientId: string; patientName: string; doctorId: string; doctorName: string;
  slotStart: string; slotEnd: string; status: "Booked" | "Cancelled" | "Completed" | "Rescheduled";
  confirmationStatus: "None" | "Pending" | "Sent" | "Confirmed" | "Reschedule requested";
  reason?: string; createdBy: string; createdAt: string; updatedAt: string;
}

export interface Insurance {
  patientId: string; provider: string; policyNo: string; validFrom: string; validTo: string;
  status: "Active" | "Expired" | "Pending" | "Rejected"; coverageType?: string; notes?: string;
  updatedBy: string; updatedAt: string;
}

export interface Alert {
  key: string;
  type: "interaction" | "allergy" | "duplicate";
  severity: Severity | "Allergy" | "Duplicate";
  drugs: string[];
  title: string;
  mechanism?: string; effect?: string; recommendation?: string; source?: string;
  requiresAck: boolean;
  explanation?: { doctor: string; patient: string } | null;
}

export type DoseStatus = "Scheduled" | "Taken" | "Skipped" | "Missed";
export interface DoseEvent {
  patientId: string; doseKey: string; itemId: string; version: number; drugId: string; drugName: string; strength: string; dose: string;
  scheduledTime: string; status: DoseStatus; critical: boolean; instructions?: string;
  confirmedAt?: string; confirmedBy?: string; skipReason?: string; reminderSentAt?: string;
}
export interface ConfirmationTask {
  appointmentId: string; doctorId: string; doctorName: string; patientId: string; patientName: string; slotStart: string; reason?: string;
  status: "Pending" | "Sent" | "Confirmed" | "Reschedule requested"; sentAt?: string; channels: string[]; deliveryStatus: Record<string, string>;
  response?: string; respondedAt?: string; createdAt: string;
}
