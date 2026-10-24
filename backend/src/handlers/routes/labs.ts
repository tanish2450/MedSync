import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Route } from "../router.js";
import { badRequest, forbidden, notFound, type Caller } from "../../lib/http.js";
import { getItem, putItem, query, scan, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { createCognitoUser } from "../../lib/cognito.js";
import { assertCanViewPatient, loadPatient, nowIso } from "../../lib/services.js";
import { imageKind } from "../../domain/scan.js";
import {
  LAB_TESTS, buildResults, canCancelLab, canChooseLab, canEnterResults, isCritical, labNext, testByCode,
  type LabStatus, type ResultRow,
} from "../../domain/labs.js";
import type { Doctor } from "../../lib/types.js";

const s3 = new S3Client({});
const BUCKET = () => { const b = process.env.ASSETS_BUCKET; if (!b) throw new Error("ASSETS_BUCKET not set"); return b; };
const MAX_B64 = 4_500_000;

export interface Lab {
  id: string; name: string; address: string; city?: string; lat: number; lng: number; phone: string; hours: string;
  tests: string[]; homeCollection: boolean; licenceNo?: string; accreditation?: string; staffIds: string[]; active: boolean; verified: boolean; createdAt: string;
}
export interface LabOrder {
  id: string; patientId: string; patientName: string; doctorId: string; doctorName: string;
  tests: { code: string; name: string }[]; priority: "Routine" | "Urgent"; fasting: boolean; clinicalNotes?: string;
  labId?: string; labName?: string; collection?: "Walk-in" | "Home collection"; address?: string;
  status: LabStatus; history: { status: LabStatus; at: string; by: string }[];
  results?: ResultRow[]; reportNote?: string; reportedAt?: string; reportedBy?: string; abnormal?: number; critical?: number;
  attachmentKey?: string; attachmentMime?: string; cancelReason?: string; createdAt: string; updatedAt: string;
}
const publicOrder = (o: LabOrder) => { const { attachmentKey, ...rest } = o; return { ...rest, hasAttachment: !!attachmentKey }; };

async function labOf(caller: Caller): Promise<string> {
  const u = await getItem<{ labId?: string }>("Users", { id: caller.sub });
  if (!u?.labId) throw forbidden("Your account is not linked to a lab");
  return u.labId;
}
async function loadOrder(id: string) { const o = await getItem<LabOrder>("LabOrders", { id }); if (!o) throw notFound("Lab order not found"); return o; }
async function loadLab(id: string) { const l = await getItem<Lab>("Labs", { id }); if (!l || !l.active) throw badRequest("Choose an active lab"); return l; }

/** Lab staff see only their lab's orders; everyone else goes through the patient-record rules (doctor assigned, nurse, patient, linked caregiver). */
async function assertParty(caller: Caller, o: LabOrder) {
  if (caller.role === "lab") { if (!o.labId || (await labOf(caller)) !== o.labId) throw forbidden(); return; }
  await assertCanViewPatient(caller, await loadPatient(o.patientId));
}
const labStaff = async (labId?: string) => (labId ? (await getItem<Lab>("Labs", { id: labId }))?.staffIds ?? [] : []);

async function move(o: LabOrder, to: LabStatus, caller: Caller, extra: Partial<LabOrder> = {}) {
  const at = nowIso();
  await updateItem("LabOrders", { id: o.id }, { ...extra, status: to, history: [...o.history, { status: to, at, by: caller.name }], updatedAt: at },
    { expr: "#st = :from", names: { "#st": "status" }, values: { ":from": o.status } });
  await audit({ actor: caller.sub, actorRole: caller.role, action: `lab.${to.toLowerCase().replace(/\s/g, "_")}`, entity: `patient#${o.patientId}`, before: { status: o.status }, after: { status: to, orderId: o.id } });
  return { ...o, ...extra, status: to, updatedAt: at };
}

export const labRoutes: Route[] = [
  // ---- catalogue + registry ----
  { method: "GET", path: "/lab-tests", roles: ["admin_nurse", "doctor", "patient", "caregiver", "lab"], handler: async () => LAB_TESTS },
  {
    method: "GET", path: "/labs", roles: ["admin_nurse", "doctor", "patient", "caregiver", "lab"],
    async handler({ caller }) {
      const all = (await scan<Lab>("Labs")).sort((a, b) => a.name.localeCompare(b.name));
      return caller.role === "admin_nurse" ? all : all.filter((l) => l.active);
    },
  },
  {
    method: "POST", path: "/labs", roles: ["admin_nurse"], status: 201,
    async handler({ caller, body }) {
      if (!body.name?.trim() || !body.address?.trim()) throw badRequest("name and address are required");
      if (typeof body.lat !== "number" || typeof body.lng !== "number") throw badRequest("lat/lng are required numbers");
      const tests = (Array.isArray(body.tests) ? body.tests : []).filter((c: string) => testByCode(c));
      if (!tests.length) throw badRequest("Choose at least one test the lab offers");
      const id = randomUUID();
      const lab: Lab = { id, name: body.name.trim(), address: body.address.trim(), lat: body.lat, lng: body.lng, phone: body.phone ?? "", hours: body.hours ?? "",
        tests, homeCollection: body.homeCollection === true, staffIds: [], active: true, verified: true, createdAt: nowIso() };
      if (body.staffEmail) {
        const sub = await createCognitoUser({ email: body.staffEmail, name: `${lab.name} staff`, role: "lab" });
        lab.staffIds.push(sub);
        await putItem("Users", { id: sub, role: "lab", name: `${lab.name} staff`, email: body.staffEmail, language: "en", status: "active", labId: id });
      }
      await putItem("Labs", lab as any);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "lab.create", entity: `lab#${id}`, after: lab });
      return lab;
    },
  },
  {
    method: "PUT", path: "/labs/:id", roles: ["admin_nurse"],
    async handler({ caller, params, body }) {
      const before = await getItem<Lab>("Labs", { id: params.id });
      if (!before) throw notFound("Lab not found");
      const patch: Record<string, unknown> = {};
      for (const k of ["verified", "active", "homeCollection"]) if (typeof body[k] === "boolean") patch[k] = body[k];
      if (!Object.keys(patch).length) throw badRequest("Nothing to update");
      await updateItem("Labs", { id: params.id }, patch);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "lab.update", entity: `lab#${params.id}`, before, after: { ...before, ...patch } });
      return { ...before, ...patch };
    },
  },
  // ---- orders ----
  {
    // doctor prescribes tests for an assigned patient
    method: "POST", path: "/patients/:id/lab-orders", roles: ["doctor"], status: 201,
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      if (!patient.assignedDoctors?.includes(caller.sub)) throw forbidden("This patient is not assigned to you");
      const codes: string[] = [...new Set<string>((Array.isArray(body.tests) ? body.tests : []).filter((c: string) => testByCode(c)))];
      if (!codes.length) throw badRequest("Choose at least one test");
      const priority = body.priority === "Urgent" ? "Urgent" : "Routine";
      const lab = body.labId ? await loadLab(body.labId) : undefined;
      if (lab && codes.some((c) => !lab.tests.includes(c))) throw badRequest(`${lab.name} does not offer every selected test`);
      const doctor = await getItem<Doctor>("Doctors", { id: caller.sub });
      const now = nowIso();
      const o: LabOrder = {
        id: randomUUID(), patientId: patient.id, patientName: patient.name, doctorId: caller.sub, doctorName: doctor?.name ?? caller.name,
        tests: codes.map((c) => ({ code: c, name: testByCode(c)!.name })), priority, fasting: codes.some((c) => testByCode(c)!.fasting),
        clinicalNotes: typeof body.clinicalNotes === "string" ? body.clinicalNotes.trim().slice(0, 1000) || undefined : undefined,
        labId: lab?.id, labName: lab?.name, collection: lab ? "Walk-in" : undefined,
        status: "Ordered", history: [{ status: "Ordered", at: now, by: caller.name }], createdAt: now, updatedAt: now,
      };
      await putItem("LabOrders", o as any);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "lab.order", entity: `patient#${patient.id}`, after: { orderId: o.id, tests: codes, priority } });
      const names = o.tests.map((t) => t.name).join(", ");
      await notify({ userId: patient.id, type: "lab.ordered", title: `${priority === "Urgent" ? "Urgent: " : ""}${o.doctorName} ordered lab tests`, body: `${names}.${o.fasting ? " Fasting needed (8–10 hours)." : ""} ${lab ? `Lab: ${lab.name}.` : "Choose a lab to get it done."}`, sms: priority === "Urgent" ? "MedSync: your doctor ordered urgent lab tests. Open MedSync." : undefined, payload: { link: "/labs" } });
      for (const s of await labStaff(lab?.id)) await notify({ userId: s, type: "lab.new", title: `New ${priority.toLowerCase()} order`, body: `${patient.name}: ${names}`, payload: { link: "/" } });
      return publicOrder(o);
    },
  },
  {
    method: "GET", path: "/lab-orders", roles: ["admin_nurse", "doctor", "patient", "lab"],
    async handler({ caller }) {
      let list: LabOrder[];
      if (caller.role === "lab") list = await query<LabOrder>("LabOrders", { index: "byLab", pk: "labId", pkValue: await labOf(caller), forward: false });
      else if (caller.role === "doctor") list = await query<LabOrder>("LabOrders", { index: "byDoctor", pk: "doctorId", pkValue: caller.sub, forward: false });
      else if (caller.role === "patient") list = await query<LabOrder>("LabOrders", { index: "byPatient", pk: "patientId", pkValue: caller.sub, forward: false });
      else list = (await scan<LabOrder>("LabOrders")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      // urgent first, then newest
      return list.sort((a, b) => Number(b.priority === "Urgent" && b.status !== "Report ready") - Number(a.priority === "Urgent" && a.status !== "Report ready") || b.createdAt.localeCompare(a.createdAt)).map(publicOrder);
    },
  },
  {
    method: "GET", path: "/patients/:id/lab-orders", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params }) {
      await assertCanViewPatient(caller, await loadPatient(params.id));
      return (await query<LabOrder>("LabOrders", { index: "byPatient", pk: "patientId", pkValue: params.id, forward: false })).map(publicOrder);
    },
  },
  {
    method: "GET", path: "/lab-orders/:id", roles: ["admin_nurse", "doctor", "patient", "caregiver", "lab"],
    async handler({ caller, params }) { const o = await loadOrder(params.id); await assertParty(caller, o); return publicOrder(o); },
  },
  {
    // patient (or linked caregiver) picks where to get it done
    method: "POST", path: "/lab-orders/:id/choose-lab", roles: ["patient", "caregiver"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (!canChooseLab(o.status)) throw badRequest("The sample has already been collected");
      const lab = await loadLab(body.labId);
      if (o.tests.some((t) => !lab.tests.includes(t.code))) throw badRequest(`${lab.name} does not offer every test on this order`);
      const collection = body.collection === "Home collection" ? "Home collection" : "Walk-in";
      if (collection === "Home collection" && !lab.homeCollection) throw badRequest(`${lab.name} does not offer home collection`);
      const address = collection === "Home collection" ? String(body.address ?? "").trim().slice(0, 300) : undefined;
      if (collection === "Home collection" && (!address || address.length < 5)) throw badRequest("Enter the address for home collection");
      const prevLab = o.labId;
      await updateItem("LabOrders", { id: o.id }, { labId: lab.id, labName: lab.name, collection, address, updatedAt: nowIso() });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "lab.choose", entity: `patient#${o.patientId}`, before: { labId: prevLab }, after: { labId: lab.id, collection } });
      for (const s of lab.staffIds) await notify({ userId: s, type: "lab.new", title: `New ${o.priority.toLowerCase()} order${collection === "Home collection" ? " · home collection" : ""}`, body: `${o.patientName}: ${o.tests.map((t) => t.name).join(", ")}`, payload: { link: "/" } });
      return publicOrder({ ...o, labId: lab.id, labName: lab.name, collection, address });
    },
  },
  {
    method: "POST", path: "/lab-orders/:id/status", roles: ["lab"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (!labNext(o.status).includes(body.status)) throw badRequest(`Cannot move from ${o.status} to ${body.status}`);
      const out = await move(o, body.status, caller);
      if (body.status === "Sample collected") await notify({ userId: o.patientId, type: "lab.collected", title: "Sample collected", body: `${o.labName} has your sample. We'll tell you when the report is ready.`, payload: { link: "/labs" } });
      return publicOrder(out);
    },
  },
  {
    method: "POST", path: "/lab-orders/:id/results", roles: ["lab"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (!canEnterResults(o.status)) throw badRequest(o.status === "Ordered" ? "Mark the sample as collected first" : `This order is ${o.status.toLowerCase()}`);
      let results: ResultRow[];
      try { results = buildResults(o.tests.map((t) => t.code), Array.isArray(body.results) ? body.results : []); }
      catch (e: any) { if (e?.missing) throw badRequest("Some results are missing or invalid", { missing: e.missing }); throw e; }
      const abnormal = results.filter((r) => r.flag !== "Normal" && r.flag !== "Reported").length;
      const critical = results.filter((r) => isCritical(r.flag)).length;
      const reportNote = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || undefined : undefined;
      const out = await move(o, "Report ready", caller, { results, abnormal, critical, reportNote, reportedAt: nowIso(), reportedBy: caller.name });
      const summary = critical ? `${critical} critical value${critical > 1 ? "s" : ""}` : abnormal ? `${abnormal} value${abnormal > 1 ? "s" : ""} outside the normal range` : "all values in range";
      await notify({ userId: o.patientId, type: "lab.ready", title: "Your lab report is ready", body: `${o.tests.map((t) => t.name).join(", ")}: ${summary}. Your doctor has been notified.`, payload: { link: "/labs" } });
      await notify({ userId: o.doctorId, type: critical ? "lab.critical" : "lab.ready", title: `${critical ? "🚨 CRITICAL lab result" : "Lab report ready"}: ${o.patientName}`, body: summary, sms: critical ? `MedSync: CRITICAL lab result for ${o.patientName}. Open MedSync now.` : undefined, payload: { link: `/patient/${o.patientId}` } });
      return publicOrder(out);
    },
  },
  {
    method: "POST", path: "/lab-orders/:id/attachment", roles: ["lab"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (typeof body.fileBase64 !== "string" || body.fileBase64.length < 100 || body.fileBase64.length > MAX_B64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(body.fileBase64)) throw badRequest("Choose a PDF or photo under 3 MB");
      const buf = Buffer.from(body.fileBase64, "base64");
      const mime = buf.subarray(0, 4).toString("latin1") === "%PDF" ? "application/pdf" : imageKind(buf);
      if (!mime) throw badRequest("Only PDF, JPEG, PNG or WebP files are supported");
      const key = `labs/${o.patientId}/${o.id}`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: buf, ContentType: mime }));
      await updateItem("LabOrders", { id: o.id }, { attachmentKey: key, attachmentMime: mime, updatedAt: nowIso() });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "lab.attachment", entity: `patient#${o.patientId}`, after: { orderId: o.id, mime } });
      return { ok: true, mime };
    },
  },
  {
    method: "GET", path: "/lab-orders/:id/attachment", roles: ["admin_nurse", "doctor", "patient", "caregiver", "lab"],
    async handler({ caller, params }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (!o.attachmentKey) throw notFound("No report file was uploaded");
      const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: o.attachmentKey }));
      const bytes = await r.Body!.transformToByteArray();
      return { mime: o.attachmentMime, base64: Buffer.from(bytes).toString("base64") };
    },
  },
  {
    // the ordering doctor, or the patient, can cancel before the sample is taken
    method: "POST", path: "/lab-orders/:id/cancel", roles: ["doctor", "patient"],
    async handler({ caller, params, body }) {
      const o = await loadOrder(params.id); await assertParty(caller, o);
      if (caller.role === "doctor" && o.doctorId !== caller.sub) throw forbidden("Only the ordering doctor can cancel this order");
      if (!canCancelLab(o.status)) throw badRequest("The sample has already been collected");
      const reason = String(body.reason ?? "").trim().slice(0, 300);
      if (!reason) throw badRequest("Give a reason for cancelling");
      const out = await move(o, "Cancelled", caller, { cancelReason: reason });
      const others = [caller.role === "doctor" ? o.patientId : o.doctorId, ...(await labStaff(o.labId))];
      for (const u of others) await notify({ userId: u, type: "lab.cancelled", title: "Lab order cancelled", body: `${o.patientName}: ${o.tests.map((t) => t.name).join(", ")}. Reason: ${reason}`, payload: { link: caller.role === "doctor" ? "/labs" : "/" } });
      return publicOrder(out);
    },
  },
];
