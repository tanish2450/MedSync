import { getItem, putItem, query, scan, updateItem } from "./db.js";
import { notify } from "./notify.js";
import { recordDoseMetric } from "./timestream.js";
import { audit } from "./audit.js";
import { dosesBetween, toIst } from "./dosesvc.js";
import { GRACE_MINUTES, REMINDER_LEAD_MINUTES, evaluateEscalation, istDate, needsReminder } from "../domain/doses.js";
import { addDays } from "../domain/versioning.js";
import type { Appointment, ConfirmationTask, DoseEvent, Patient } from "./types.js";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

async function byStatus(status: string, from: string, to: string) {
  return query<DoseEvent>("DoseEvents", { index: "byStatus", pk: "status", pkValue: status, skName: "scheduledTime", skBetween: [from, to] });
}

/** Runs every minute (EventBridge). Idempotent: reminders/alerts are deduplicated; Missed flip is a conditional write. */
export async function runTick(now = new Date()) {
  const stats = { reminders: 0, missed: 0, escalations: 0 };

  // 1) Upcoming-dose reminders (10 minutes before)
  const soon = await byStatus("Scheduled", toIst(now), toIst(new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60000)));
  for (const e of soon.filter((x) => needsReminder(x, now))) {
    const sent = await notify({
      userId: e.patientId, type: "dose.upcoming", title: "Dose coming up", body: `${e.drugName} ${e.strength} at ${fmtTime(e.scheduledTime)}: ${e.dose}${e.instructions ? ` (${e.instructions})` : ""}`,
      sms: `MedSync reminder: a medicine dose is due at ${fmtTime(e.scheduledTime)}. Open MedSync to mark it.`, payload: { doseKey: e.doseKey }, dedupeKey: `reminder#${e.doseKey}`,
    });
    if (sent) { stats.reminders++; await updateItem("DoseEvents", { patientId: e.patientId, doseKey: e.doseKey }, { reminderSentAt: now.toISOString() }); }
  }

  // 2) Doses past the grace window become Missed
  const cutoff = toIst(new Date(now.getTime() - GRACE_MINUTES * 60000));
  const overdue = await byStatus("Scheduled", "0000", cutoff);
  const affected = new Set<string>();
  for (const e of overdue) {
    try {
      await updateItem("DoseEvents", { patientId: e.patientId, doseKey: e.doseKey }, { status: "Missed" },
        { expr: "#st = :sc", names: { "#st": "status" }, values: { ":sc": "Scheduled" } });
    } catch (err: any) { if (err?.name === "ConditionalCheckFailedException") continue; throw err; }
    stats.missed++; affected.add(e.patientId);
    await notify({
      userId: e.patientId, type: "dose.missed", title: "Missed dose", body: `You missed ${e.drugName} ${e.strength} scheduled at ${fmtTime(e.scheduledTime)}. Check your medicine instructions or ask your doctor what to do next.`,
      sms: "MedSync: you missed a scheduled medicine dose. Open MedSync for details.", payload: { doseKey: e.doseKey }, dedupeKey: `missed#${e.doseKey}`,
    });
    void recordDoseMetric({ patientId: e.patientId, drugId: e.drugId, status: "Missed", time: new Date(e.scheduledTime) });
  }

  // 3) Escalation rules for patients that just had a missed dose
  const today = istDate(now);
  for (const patientId of affected) {
    const last7 = await dosesBetween(patientId, addDays(today, -6), today);
    const esc = evaluateEscalation(last7, now);
    const patient = await getItem<Patient>("Patients", { id: patientId });
    if (!patient) continue;
    if (esc.caregiver) {
      const links = await query<{ caregiverId: string; status: string }>("CaregiverLinks", { pk: "patientId", pkValue: patientId });
      for (const l of links.filter((x) => x.status === "Active")) {
        const ok = await notify({ userId: l.caregiverId, type: "adherence.caregiver", title: `${patient.name}: missed doses`, body: esc.caregiver,
          sms: "MedSync: a patient you support has missed doses. Open MedSync.", payload: { patientId }, dedupeKey: `esc-cg#${patientId}#${today}` });
        if (ok) stats.escalations++;
      }
    }
    if (esc.doctor) {
      for (const d of patient.assignedDoctors ?? []) {
        const ok = await notify({ userId: d, type: "adherence.doctor", title: `Adherence alert: ${patient.name}`, body: esc.doctor,
          sms: "MedSync: adherence alert for one of your patients. Open MedSync.", payload: { patientId }, dedupeKey: `esc-doc#${patientId}#${today}#${d}` });
        if (ok) stats.escalations++;
      }
      await audit({ actor: "system", actorRole: "system", action: "adherence.escalate.doctor", entity: `patient#${patientId}`, after: { reason: esc.doctor } });
    }
  }
  return stats;
}

/** Daily (18:00 IST): create a confirmation task for tomorrow's appointments and message the doctor automatically. */
export async function runDayBefore(now = new Date()) {
  const tomorrow = addDays(istDate(now), 1);
  const appts = (await scan<Appointment>("Appointments")).filter((a) => a.status === "Booked" && a.slotStart.startsWith(tomorrow));
  let created = 0;
  for (const a of appts) {
    const task: ConfirmationTask = {
      appointmentId: a.id, doctorId: a.doctorId, doctorName: a.doctorName, patientId: a.patientId, patientName: a.patientName,
      slotStart: a.slotStart, reason: a.reason, status: "Pending", channels: ["in-app"], deliveryStatus: {}, createdAt: now.toISOString(),
    };
    try { await putItem("ConfirmationTasks", task as any, "attribute_not_exists(appointmentId)"); }
    catch (e: any) { if (e?.name === "ConditionalCheckFailedException") continue; throw e; }
    const t = new Date(a.slotStart).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
    await notify({
      userId: a.doctorId, type: "appointment.confirm", title: "Please confirm tomorrow's appointment", body: `${a.patientName} at ${t}${a.reason ? ` (${a.reason})` : ""}. Confirm or request a reschedule.`,
      sms: `MedSync: please confirm tomorrow's appointment at ${fmtTime(a.slotStart)}. Open MedSync to respond.`, payload: { appointmentId: a.id }, dedupeKey: `confirm#${a.id}`,
    });
    const sentAt = now.toISOString();
    await updateItem("ConfirmationTasks", { appointmentId: a.id }, { status: "Sent", sentAt, channels: ["in-app", "sms"], deliveryStatus: { "in-app": "delivered", sms: process.env.SMS_ENABLED === "true" ? "attempted" : "disabled" } });
    await updateItem("Appointments", { id: a.id }, { confirmationStatus: "Sent", updatedAt: sentAt });
    created++;
  }
  return { tomorrow, created };
}

