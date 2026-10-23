import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Route } from "../router.js";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/http.js";
import { getItem, putItem, query, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { notify } from "../../lib/notify.js";
import { catalogue, loadPatient, nowIso } from "../../lib/services.js";
import { extractPrescription } from "../../lib/groq.js";
import { buildDraft, imageKind, parseModelJson, sanitizeExtraction, type DraftItem } from "../../domain/scan.js";
import type { Caller } from "../../lib/http.js";
import type { Doctor } from "../../lib/types.js";

const s3 = new S3Client({});
const BUCKET = () => { const b = process.env.ASSETS_BUCKET; if (!b) throw new Error("ASSETS_BUCKET not set"); return b; };
const MAX_B64 = 4_500_000; // keeps the whole request under Lambda's 6 MB limit
const DAILY_LIMIT = 10;

export type ScanStatus = "Pending review" | "Added" | "Rejected";
export interface Scan {
  id: string; patientId: string; patientName: string; doctorId: string; doctorName: string; imageKey: string; mime: string;
  status: ScanStatus; extraction: "ok" | "unreadable" | "unavailable"; extractionNote?: string; prescriberOnPaper?: string | null; prescriptionDate?: string | null;
  items: DraftItem[]; patientNote?: string; createdAt: string; reviewedAt?: string; rejectReason?: string; prescriptionId?: string;
}

const publicScan = (s: Scan) => { const { imageKey, ...rest } = s; void imageKey; return rest; };

async function loadScan(id: string): Promise<Scan> {
  const s = await getItem<Scan>("PrescriptionScans", { id });
  if (!s) throw notFound("Prescription upload not found");
  return s;
}
function assertParty(caller: Caller, s: Scan) {
  if (caller.role === "patient" && s.patientId === caller.sub) return;
  if (caller.role === "doctor" && s.doctorId === caller.sub) return;
  throw forbidden("You do not have access to this upload");
}

/** Used by POST /patients/:id/prescriptions when a doctor finalises a prescription that came from an upload. */
export async function requireOpenScan(scanId: string, caller: Caller, patientId: string): Promise<Scan> {
  const s = await loadScan(scanId);
  if (s.doctorId !== caller.sub || s.patientId !== patientId) throw forbidden("This upload was not sent to you for this patient");
  if (s.status !== "Pending review") throw badRequest(`This upload is already ${s.status.toLowerCase()}`);
  return s;
}
export async function finishScan(s: Scan, prescriptionId: string, caller: Caller) {
  await updateItem("PrescriptionScans", { id: s.id }, { status: "Added", prescriptionId, reviewedAt: nowIso() }, { expr: "#st = :p", names: { "#st": "status" }, values: { ":p": "Pending review" } });
  await notify({ userId: s.patientId, type: "prescription_added", title: "Your prescription was added", body: `${caller.name} reviewed your uploaded prescription and added the medicines. Reminders are now set.`, payload: { link: "/health" }, dedupeKey: `scan-added-${s.id}` }).catch(() => undefined);
}

export const scanRoutes: Route[] = [
  {
    method: "POST", path: "/scans", roles: ["patient"], status: 201,
    async handler({ caller, body }) {
      if (body.consent !== true) throw badRequest("Please accept that your prescription photo is processed by an AI service and shared with the selected doctor");
      if (typeof body.imageBase64 !== "string" || body.imageBase64.length < 100) throw badRequest("Choose a photo of the prescription");
      if (body.imageBase64.length > MAX_B64) throw badRequest("That photo is too large. Take it again or choose a smaller one");
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(body.imageBase64)) throw badRequest("The image data is not valid");
      const buf = Buffer.from(body.imageBase64, "base64");
      const mime = imageKind(buf);
      if (!mime) throw badRequest("Only JPEG, PNG or WebP photos are supported");
      const doctor = typeof body.doctorId === "string" ? await getItem<Doctor>("Doctors", { id: body.doctorId }) : undefined;
      if (!doctor || !doctor.active) throw badRequest("Choose the doctor who prescribed these medicines");
      const patient = await loadPatient(caller.sub);
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const recent = await query<Scan>("PrescriptionScans", { index: "byPatient", pk: "patientId", pkValue: caller.sub, forward: false, limit: DAILY_LIMIT + 1 });
      if (recent.filter((r) => r.createdAt >= since).length >= DAILY_LIMIT) throw new HttpError(429, "Daily upload limit reached. Try again tomorrow");

      const id = randomUUID(); const imageKey = `scans/${caller.sub}/${id}`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET(), Key: imageKey, Body: buf, ContentType: mime }));

      let status: Scan["extraction"] = "unavailable"; let items: DraftItem[] = []; let prescriberOnPaper: string | null = null; let prescriptionDate: string | null = null; let note: string | undefined;
      const r = await extractPrescription(body.imageBase64, mime);
      if (r.ok) {
        const ex = sanitizeExtraction(parseModelJson(r.text));
        prescriberOnPaper = ex.prescriberName; prescriptionDate = ex.prescriptionDate;
        if (ex.legible) { items = buildDraft(ex, await catalogue()); status = "ok"; }
        else { status = "unreadable"; note = "The photo could not be read clearly. Your doctor will enter the medicines from the photo."; }
      } else {
        note = r.reason === "rate_limited" ? "The reading service is busy. Your doctor will enter the medicines from the photo." : "Automatic reading is unavailable. Your doctor will enter the medicines from the photo.";
      }
      const scan: Scan = {
        id, patientId: patient.id, patientName: patient.name, doctorId: doctor.id, doctorName: doctor.name, imageKey, mime, status: "Pending review",
        extraction: status, extractionNote: note, prescriberOnPaper, prescriptionDate, items, patientNote: typeof body.note === "string" ? body.note.trim().slice(0, 500) || undefined : undefined, createdAt: nowIso(),
      };
      await putItem("PrescriptionScans", scan as any);
      // Choosing the prescribing doctor is the patient's consent to share their record with them.
      if (!patient.assignedDoctors?.includes(doctor.id)) await updateItem("Patients", { id: patient.id }, { assignedDoctors: [...(patient.assignedDoctors ?? []), doctor.id], updatedAt: nowIso() });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "prescription.upload", entity: `patient#${patient.id}`, after: { scanId: id, doctorId: doctor.id, extraction: status, items: items.length } });
      await notify({ userId: doctor.id, type: "prescription_upload", title: "New prescription upload", body: `${patient.name} uploaded a prescription for you to review${items.length ? ` (${items.length} medicine${items.length === 1 ? "" : "s"} read)` : ""}.`, payload: { link: `/scans/${id}` }, dedupeKey: `scan-${id}` }).catch(() => undefined);
      return publicScan(scan);
    },
  },
  {
    method: "GET", path: "/scans", roles: ["patient", "doctor"],
    async handler({ caller }) {
      const list = caller.role === "patient"
        ? await query<Scan>("PrescriptionScans", { index: "byPatient", pk: "patientId", pkValue: caller.sub, forward: false })
        : await query<Scan>("PrescriptionScans", { index: "byDoctor", pk: "doctorId", pkValue: caller.sub, forward: false });
      return list.map(publicScan);
    },
  },
  {
    method: "GET", path: "/scans/:id", roles: ["patient", "doctor"],
    async handler({ caller, params }) {
      const s = await loadScan(params.id); assertParty(caller, s);
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: s.imageKey }));
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      const cat = await catalogue();
      const items = s.items.map((it) => ({ ...it, drug: it.drugId ? cat.find((d) => d.drugId === it.drugId) ?? null : null }));
      return { ...publicScan(s), items, image: `data:${s.mime};base64,${bytes.toString("base64")}` };
    },
  },
  {
    method: "POST", path: "/scans/:id/reject", roles: ["doctor"],
    async handler({ caller, params, body }) {
      const s = await loadScan(params.id); assertParty(caller, s);
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 3) throw badRequest("Give a short reason so the patient knows what to do next");
      try { await updateItem("PrescriptionScans", { id: s.id }, { status: "Rejected", rejectReason: reason.slice(0, 300), reviewedAt: nowIso() }, { expr: "#st = :p", names: { "#st": "status" }, values: { ":p": "Pending review" } }); }
      catch (e: any) { if (e?.name === "ConditionalCheckFailedException") throw badRequest("This upload was already reviewed"); throw e; }
      await audit({ actor: caller.sub, actorRole: caller.role, action: "prescription.upload.reject", entity: `patient#${s.patientId}`, after: { scanId: s.id, reason } });
      await notify({ userId: s.patientId, type: "prescription_rejected", title: "Prescription upload not accepted", body: `${caller.name}: ${reason}`, payload: { link: "/prescriptions" }, dedupeKey: `scan-rej-${s.id}` }).catch(() => undefined);
      return { ok: true };
    },
  },
];
