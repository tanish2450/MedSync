import type { Route } from "../router.js";
import { badRequest, forbidden, notFound } from "../../lib/http.js";
import { getItem, query, scan, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { nowIso } from "../../lib/services.js";
import type { Appointment, ConfirmationTask } from "../../lib/types.js";

const CALL_AFTER_HOURS = 4; // flag for the nurse to call/reassign if the doctor has not responded

const withFlag = (t: ConfirmationTask) => ({
  ...t, needsCall: (t.status === "Pending" || t.status === "Sent") && !!t.sentAt && Date.now() - new Date(t.sentAt).getTime() > CALL_AFTER_HOURS * 3600_000,
});

export const notificationRoutes: Route[] = [
  {
    method: "GET", path: "/notifications", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy", "lab"],
    async handler({ caller }) {
      const rows = await query<any>("Notifications", { pk: "userId", pkValue: caller.sub, forward: false, limit: 60 });
      const items = rows.filter((r) => !String(r.id).startsWith("!dedupe#")).slice(0, 40);
      return { unread: items.filter((r) => !r.readAt).length, items };
    },
  },
  {
    method: "POST", path: "/notifications/read-all", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy", "lab"],
    async handler({ caller }) {
      const rows = (await query<any>("Notifications", { pk: "userId", pkValue: caller.sub, forward: false, limit: 60 })).filter((r) => !String(r.id).startsWith("!dedupe#") && !r.readAt);
      const readAt = nowIso();
      for (const r of rows) await updateItem("Notifications", { userId: caller.sub, id: r.id }, { readAt });
      return { marked: rows.length };
    },
  },
  {
    method: "GET", path: "/confirmations", roles: ["admin_nurse"],
    async handler() { return (await scan<ConfirmationTask>("ConfirmationTasks")).map(withFlag).sort((a, b) => a.slotStart.localeCompare(b.slotStart)); },
  },
  {
    method: "GET", path: "/confirmations/mine", roles: ["doctor"],
    async handler({ caller }) {
      return (await query<ConfirmationTask>("ConfirmationTasks", { index: "byDoctor", pk: "doctorId", pkValue: caller.sub })).map(withFlag).sort((a, b) => a.slotStart.localeCompare(b.slotStart));
    },
  },
  {
    method: "POST", path: "/confirmations/:appointmentId/respond", roles: ["doctor"],
    async handler({ caller, params, body }) {
      if (!["Confirmed", "Reschedule requested"].includes(body.response)) throw badRequest("response must be Confirmed or Reschedule requested");
      const task = await getItem<ConfirmationTask>("ConfirmationTasks", { appointmentId: params.appointmentId });
      if (!task) throw notFound("No confirmation task for this appointment");
      if (task.doctorId !== caller.sub) throw forbidden();
      const respondedAt = nowIso();
      await updateItem("ConfirmationTasks", { appointmentId: task.appointmentId }, { status: body.response, response: body.response, respondedAt });
      await updateItem("Appointments", { id: task.appointmentId }, { confirmationStatus: body.response, updatedAt: respondedAt });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "appointment.confirmation", entity: `patient#${task.patientId}`, before: task, after: { ...task, status: body.response, respondedAt } });
      const appt = await getItem<Appointment>("Appointments", { id: task.appointmentId });
      if (body.response === "Reschedule requested" && appt) {
        await notify({ userId: task.patientId, type: "appointment.reschedule", title: "Your doctor asked to reschedule", body: `${task.doctorName} has requested a new time for your appointment. Please pick another slot.`, sms: "MedSync: your doctor asked to reschedule your appointment. Open MedSync.", payload: { appointmentId: task.appointmentId } });
      }
      const staff = await query<{ id: string }>("Users", { index: "byRole", pk: "role", pkValue: "admin_nurse" });
      for (const s of staff) await notify({ userId: s.id, type: "appointment.confirmation", title: `${task.doctorName}: ${body.response}`, body: `${task.patientName}, ${new Date(task.slotStart).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}`, payload: { appointmentId: task.appointmentId } });
      return { ...task, status: body.response, respondedAt };
    },
  },
];
