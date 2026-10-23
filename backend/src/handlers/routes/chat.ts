import { randomUUID } from "node:crypto";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Route } from "../router.js";
import { badRequest, forbidden, type Caller } from "../../lib/http.js";
import { ddb, getItem, putItem, query, tn, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { loadPatient, nowIso } from "../../lib/services.js";
import { NURSE_DESK, canUseThread, cleanText, parseThreadId, sortThreads, threadId, uniqueThreads, type ThreadKey } from "../../domain/chat.js";
import type { Patient } from "../../lib/types.js";

export interface ChatThread {
  id: string; patientId: string; patientName: string; staffKey: string; staffName: string; staffRole: "doctor" | "admin_nurse";
  emergency: boolean; lastAt: string; lastText: string; lastSenderRole: string; unreadPatient: number; unreadStaff: number; createdAt: string;
}
export interface ChatMessage {
  threadId: string; msgKey: string; id: string; senderId: string; senderName: string; senderRole: string;
  text: string; emergency: boolean; kind: "text" | "system"; createdAt: string;
}

const STAFF_ROLES = ["doctor", "admin_nurse"] as const;
const CHAT_ROLES = ["patient", "doctor", "admin_nurse"] as const;

async function staffInfo(staffKey: string): Promise<{ staffName: string; staffRole: ChatThread["staffRole"] }> {
  if (staffKey === NURSE_DESK) return { staffName: "Nursing desk", staffRole: "admin_nurse" };
  const d = await getItem<{ name?: string }>("Doctors", { id: staffKey });
  return { staffName: d?.name ?? "Doctor", staffRole: "doctor" };
}
const nurseIds = async () => (await query<{ id: string }>("Users", { index: "byRole", pk: "role", pkValue: "admin_nurse" })).map((u) => u.id);
/** Everyone on the other side of the thread from the sender. */
async function recipients(key: ThreadKey, senderRole: string): Promise<string[]> {
  if (senderRole !== "patient") return [key.patientId];
  return key.staffKey === NURSE_DESK ? nurseIds() : [key.staffKey];
}

async function access(caller: Caller, id: string): Promise<{ key: ThreadKey; patient: Patient }> {
  const key = parseThreadId(id);
  if (!key) throw badRequest("Invalid conversation id");
  const patient = await loadPatient(key.patientId);
  if (!canUseThread(caller.role, caller.sub, key, patient.assignedDoctors ?? [])) throw forbidden("You cannot use this conversation");
  return { key, patient };
}

/** Appends a message and upserts the thread summary in one place, bumping the other side's unread count. */
async function append(key: ThreadKey, patient: Patient, from: { id: string; name: string; role: string }, text: string, kind: ChatMessage["kind"] = "text") {
  const createdAt = nowIso(); const id = threadId(key.patientId, key.staffKey);
  const emergency = !!patient.emergency?.active;
  const msg: ChatMessage = { threadId: id, msgKey: `${createdAt}#${randomUUID().slice(0, 8)}`, id: randomUUID(), senderId: from.id, senderName: from.name, senderRole: from.role, text, emergency, kind, createdAt };
  await putItem("ChatMessages", msg as any);
  const { staffName, staffRole } = await staffInfo(key.staffKey);
  await ddb.send(new UpdateCommand({
    TableName: tn("ChatThreads"), Key: { id },
    UpdateExpression: "SET patientId = :p, patientName = :pn, staffKey = :s, staffName = :sn, staffRole = :sr, emergency = :e, lastAt = :t, lastText = :x, lastSenderRole = :r, createdAt = if_not_exists(createdAt, :t) ADD #unread :one",
    ExpressionAttributeNames: { "#unread": from.role === "patient" ? "unreadStaff" : "unreadPatient" },
    ExpressionAttributeValues: { ":p": key.patientId, ":pn": patient.name, ":s": key.staffKey, ":sn": staffName, ":sr": staffRole, ":e": emergency, ":t": createdAt, ":x": text.slice(0, 140), ":r": from.role, ":one": 1 },
  }));
  return msg;
}

/** Patient's own contacts: every assigned doctor plus the nurse desk. */
const contactsOf = (p: Patient) => [...(p.assignedDoctors ?? []), NURSE_DESK];

async function setEmergency(patient: Patient, active: boolean, by: Caller, note?: string) {
  if (!!patient.emergency?.active === active) return patient.emergency;
  const at = nowIso();
  const state = active ? { active: true, since: at, note: note || undefined, raisedBy: by.sub } : { ...patient.emergency, active: false, clearedAt: at, clearedBy: by.sub };
  await updateItem("Patients", { id: patient.id }, { emergency: state, updatedAt: at });
  await audit({ actor: by.sub, actorRole: by.role, action: active ? "emergency.raise" : "emergency.clear", entity: `patient#${patient.id}`, before: patient.emergency ?? null, after: state });
  const updated = { ...patient, emergency: state } as Patient;
  const text = active ? `🚨 Emergency raised${note ? `: ${note}` : ". Please contact the patient now."}` : `Emergency cleared by ${by.role === "patient" ? "the patient" : by.name}.`;
  for (const staffKey of contactsOf(patient)) await append({ patientId: patient.id, staffKey }, updated, { id: by.sub, name: by.name, role: by.role }, text, "system");

  const staff = [...(patient.assignedDoctors ?? []), ...(await nurseIds())].filter((id) => id !== by.sub);
  const caregivers = (await query<{ caregiverId: string; status: string }>("CaregiverLinks", { pk: "patientId", pkValue: patient.id })).filter((l) => l.status === "Active").map((l) => l.caregiverId);
  for (const userId of [...new Set([...staff, ...caregivers])]) {
    await notify(active
      ? { userId, type: "emergency.raised", title: `🚨 EMERGENCY: ${patient.name}`, body: note ? `"${note}"` : "The patient switched on emergency mode. Open their conversation now.", sms: `MedSync EMERGENCY: ${patient.name} needs help now. Open MedSync.`, payload: { link: "/messages", patientId: patient.id } }
      : { userId, type: "emergency.cleared", title: `Emergency cleared: ${patient.name}`, body: text, payload: { link: "/messages", patientId: patient.id } });
  }
  return state;
}

export const chatRoutes: Route[] = [
  {
    method: "GET", path: "/chats", roles: [...CHAT_ROLES],
    async handler({ caller }) {
      if (caller.role === "patient") {
        const patient = await loadPatient(caller.sub);
        const existing = await query<ChatThread>("ChatThreads", { index: "byPatient", pk: "patientId", pkValue: caller.sub });
        // contacts without a conversation yet appear as empty threads the patient can start
        const missing = await Promise.all(contactsOf(patient).filter((s) => !existing.some((t) => t.staffKey === s)).map(async (staffKey) => ({
          id: threadId(caller.sub, staffKey), patientId: caller.sub, patientName: patient.name, staffKey, ...(await staffInfo(staffKey)),
          emergency: !!patient.emergency?.active, lastAt: "", lastText: "", lastSenderRole: "", unreadPatient: 0, unreadStaff: 0, createdAt: "",
        })));
        const threads = [...existing.filter((t) => contactsOf(patient).includes(t.staffKey)), ...missing].map((t) => ({ ...t, unread: t.unreadPatient ?? 0 }));
        return { threads: uniqueThreads(sortThreads(threads), (t) => t.staffKey), emergency: patient.emergency ?? { active: false } };
      }
      const staffKey = caller.role === "doctor" ? caller.sub : NURSE_DESK;
      const threads = await query<ChatThread>("ChatThreads", { index: "byStaff", pk: "staffKey", pkValue: staffKey });
      return { threads: uniqueThreads(sortThreads(threads.map((t) => ({ ...t, unread: t.unreadStaff ?? 0 }))), (t) => t.patientId) };
    },
  },
  {
    // doctor / nurse opens (or resumes) a follow-up conversation with a patient
    method: "POST", path: "/chats/start", roles: [...STAFF_ROLES],
    async handler({ caller, body }) {
      if (!body.patientId) throw badRequest("patientId is required");
      const id = threadId(body.patientId, caller.role === "doctor" ? caller.sub : NURSE_DESK);
      await access(caller, id);
      return { id };
    },
  },
  {
    method: "GET", path: "/chats/:id/messages", roles: [...CHAT_ROLES],
    async handler({ caller, params }) {
      const { key, patient } = await access(caller, params.id);
      const rows = await query<ChatMessage>("ChatMessages", { pk: "threadId", pkValue: params.id, forward: false, limit: 200 });
      const thread = await getItem<ChatThread>("ChatThreads", { id: params.id });
      const unreadField = caller.role === "patient" ? "unreadPatient" : "unreadStaff";
      if (thread?.[unreadField]) await updateItem("ChatThreads", { id: params.id }, { [unreadField]: 0 });
      const info = thread ?? { id: params.id, patientId: key.patientId, patientName: patient.name, staffKey: key.staffKey, ...(await staffInfo(key.staffKey)) };
      return { thread: { ...info, emergency: !!patient.emergency?.active }, emergency: patient.emergency ?? { active: false }, messages: rows.reverse() };
    },
  },
  {
    method: "POST", path: "/chats/:id/messages", roles: [...CHAT_ROLES], status: 201,
    async handler({ caller, params, body }) {
      const text = cleanText(body.text);
      if (!text) throw badRequest("Message must be 1–2000 characters");
      const { key, patient } = await access(caller, params.id);
      const msg = await append(key, patient, { id: caller.sub, name: caller.name, role: caller.role }, text);
      const urgent = msg.emergency && caller.role === "patient";
      for (const userId of await recipients(key, caller.role)) {
        await notify({
          userId, type: urgent ? "chat.emergency" : "chat.message",
          title: urgent ? `🚨 EMERGENCY message from ${patient.name}` : `New message from ${caller.role === "patient" ? patient.name : caller.name}`,
          body: text.slice(0, 120), sms: urgent ? `MedSync EMERGENCY message from ${patient.name}. Open MedSync now.` : undefined,
          payload: { link: "/messages", threadId: params.id },
        });
      }
      return msg;
    },
  },
  {
    method: "GET", path: "/emergency", roles: ["patient"],
    async handler({ caller }) { return (await loadPatient(caller.sub)).emergency ?? { active: false }; },
  },
  {
    method: "POST", path: "/emergency", roles: ["patient"],
    async handler({ caller, body }) {
      if (typeof body.active !== "boolean") throw badRequest("active must be true or false");
      const note = body.note === undefined ? undefined : cleanText(body.note);
      if (body.note && !note) throw badRequest("Note must be 1–2000 characters");
      return setEmergency(await loadPatient(caller.sub), body.active, caller, note ?? undefined);
    },
  },
  {
    // the care team marks the emergency handled once they have reached the patient
    method: "POST", path: "/emergency/:patientId/resolve", roles: [...STAFF_ROLES],
    async handler({ caller, params }) {
      const patient = await loadPatient(params.patientId);
      if (caller.role === "doctor" && !patient.assignedDoctors?.includes(caller.sub)) throw forbidden("This patient is not assigned to you");
      return setEmergency(patient, false, caller);
    },
  },
];
