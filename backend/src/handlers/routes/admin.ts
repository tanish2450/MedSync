import { randomUUID } from "node:crypto";
import type { Route } from "../router.js";
import { badRequest, notFound } from "../../lib/http.js";
import { getItem, putItem, query, scan, updateItem } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { cognitoUserExists, createCognitoUser } from "../../lib/cognito.js";
import { assertCanViewPatient, catalogue, loadPatient, nowIso } from "../../lib/services.js";
import { maskPolicy } from "./patients.js";
import type { Insurance } from "../../lib/types.js";

const INS_STATUS = ["Active", "Expired", "Pending", "Rejected"];
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const adminRoutes: Route[] = [
  {
    method: "GET", path: "/me", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy"],
    async handler({ caller }) {
      const profile = caller.role === "patient" ? await getItem("Patients", { id: caller.sub })
        : caller.role === "doctor" ? await getItem("Doctors", { id: caller.sub }) : null;
      return { ...caller, profile };
    },
  },
  {
    method: "GET", path: "/drugs", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy"],
    async handler({ query: q }) {
      const term = (q.q ?? "").toLowerCase().trim();
      const all = await catalogue();
      const list = term ? all.filter((d) => [d.genericName, ...d.brandNames, ...d.ingredients, ...d.classes].some((v) => v.toLowerCase().includes(term))) : all;
      return list.sort((a, b) => a.genericName.localeCompare(b.genericName)).slice(0, Number(q.limit ?? 25));
    },
  },
  // ---- Insurance (admin/nurse manage; everyone with record access views) ----
  {
    method: "GET", path: "/patients/:id/insurance", roles: ["admin_nurse", "doctor", "patient", "caregiver"],
    async handler({ caller, params }) {
      const patient = await loadPatient(params.id);
      await assertCanViewPatient(caller, patient);
      const ins = await getItem<Insurance>("Insurance", { patientId: patient.id });
      if (!ins) return null;
      return caller.role === "admin_nurse" ? ins : { ...ins, policyNo: maskPolicy(ins.policyNo) };
    },
  },
  {
    method: "PUT", path: "/patients/:id/insurance", roles: ["admin_nurse"],
    async handler({ caller, params, body }) {
      const patient = await loadPatient(params.id);
      for (const f of ["provider", "policyNo"]) if (!body[f]?.trim?.()) throw badRequest(`${f} is required`);
      if (!isDate(body.validFrom) || !isDate(body.validTo)) throw badRequest("validFrom/validTo must be YYYY-MM-DD");
      if (body.validTo < body.validFrom) throw badRequest("validTo is before validFrom");
      if (!INS_STATUS.includes(body.status)) throw badRequest(`status must be one of ${INS_STATUS.join(", ")}`);
      const before = await getItem<Insurance>("Insurance", { patientId: patient.id });
      const now = nowIso();
      const ins: Insurance = {
        patientId: patient.id, provider: body.provider, policyNo: body.policyNo, validFrom: body.validFrom, validTo: body.validTo,
        status: body.status, coverageType: body.coverageType, notes: body.notes, updatedBy: caller.name, updatedAt: now,
      };
      await putItem("Insurance", ins as any);
      await putItem("InsuranceHistory", { ...ins, ts: `${now}#${randomUUID().slice(0, 8)}`, previous: before ?? null });
      await audit({ actor: caller.sub, actorRole: caller.role, action: "insurance.update", entity: `patient#${patient.id}`, before: before ?? null, after: ins });
      return ins;
    },
  },
  {
    method: "GET", path: "/patients/:id/insurance/history", roles: ["admin_nurse"],
    async handler({ params }) { return query("InsuranceHistory", { pk: "patientId", pkValue: params.id, forward: false, limit: 100 }); },
  },
  // ---- Pharmacies ----
  {
    method: "GET", path: "/pharmacies", roles: ["admin_nurse", "doctor", "patient", "caregiver", "pharmacy"],
    handler: async () => (await scan<any>("Pharmacies")).sort((a, b) => a.name.localeCompare(b.name)),
  },
  {
    method: "POST", path: "/pharmacies", roles: ["admin_nurse"], status: 201,
    async handler({ caller, body }) {
      if (!body.name?.trim() || !body.address?.trim()) throw badRequest("name and address are required");
      if (typeof body.lat !== "number" || typeof body.lng !== "number") throw badRequest("lat/lng are required numbers");
      const id = randomUUID();
      const pharmacy = { id, name: body.name, address: body.address, lat: body.lat, lng: body.lng, hours: body.hours ?? "", phone: body.phone ?? "", staffIds: [] as string[], active: true, createdAt: nowIso() };
      if (body.staffEmail) {
        const sub = await createCognitoUser({ email: body.staffEmail, name: `${body.name} staff`, role: "pharmacy" });
        pharmacy.staffIds.push(sub);
        await putItem("Users", { id: sub, role: "pharmacy", name: `${body.name} staff`, email: body.staffEmail, language: "en", status: "active", pharmacyId: id });
      }
      await putItem("Pharmacies", pharmacy);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "pharmacy.create", entity: `pharmacy#${id}`, after: pharmacy });
      return pharmacy;
    },
  },
  {
    method: "PUT", path: "/pharmacies/:id", roles: ["admin_nurse"],
    async handler({ caller, params, body }) {
      const before = await getItem<any>("Pharmacies", { id: params.id });
      if (!before) throw notFound("Pharmacy not found");
      const patch: Record<string, unknown> = {};
      for (const k of ["verified", "active"]) if (typeof body[k] === "boolean") patch[k] = body[k];
      if (!Object.keys(patch).length) throw badRequest("Nothing to update");
      await updateItem("Pharmacies", { id: params.id }, patch);
      const after = { ...before, ...patch };
      await audit({ actor: caller.sub, actorRole: caller.role, action: "pharmacy.update", entity: `pharmacy#${params.id}`, before, after });
      return after;
    },
  },
  // ---- Caregiver linking (patient invites; caregiver accepts; patient can revoke any time) ----
  {
    method: "GET", path: "/caregivers", roles: ["patient", "caregiver"],
    async handler({ caller }) {
      if (caller.role === "patient") return query("CaregiverLinks", { pk: "patientId", pkValue: caller.sub });
      return query("CaregiverLinks", { index: "byCaregiver", pk: "caregiverId", pkValue: caller.sub });
    },
  },
  {
    method: "POST", path: "/caregivers/invite", roles: ["patient"], status: 201,
    async handler({ caller, body }) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? "")) throw badRequest("A valid caregiver email is required");
      let caregiverId = await cognitoUserExists(body.email);
      if (!caregiverId) {
        caregiverId = await createCognitoUser({ email: body.email, name: body.name ?? body.email, role: "caregiver" });
        await putItem("Users", { id: caregiverId, role: "caregiver", name: body.name ?? body.email, email: body.email, language: "en", status: "active" });
      } else {
        const u = await getItem<{ role: string }>("Users", { id: caregiverId });
        if (u?.role !== "caregiver") throw badRequest("That email belongs to a non-caregiver account");
      }
      const link = { patientId: caller.sub, caregiverId, caregiverEmail: body.email, caregiverName: body.name ?? body.email, status: "Pending", permissions: ["view", "mark-dose"], createdAt: nowIso() };
      await putItem("CaregiverLinks", link);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "caregiver.invite", entity: `patient#${caller.sub}`, after: link });
      return link;
    },
  },
  {
    method: "POST", path: "/caregivers/accept", roles: ["caregiver"],
    async handler({ caller, body }) {
      const link = await getItem<any>("CaregiverLinks", { patientId: body.patientId, caregiverId: caller.sub });
      if (!link || link.status !== "Pending") throw notFound("No pending invitation");
      const upd = { ...link, status: "Active", acceptedAt: nowIso() };
      await putItem("CaregiverLinks", upd);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "caregiver.accept", entity: `patient#${link.patientId}`, before: link, after: upd });
      return upd;
    },
  },
  {
    method: "DELETE", path: "/caregivers/:caregiverId", roles: ["patient"],
    async handler({ caller, params }) {
      const link = await getItem<any>("CaregiverLinks", { patientId: caller.sub, caregiverId: params.caregiverId });
      if (!link) throw notFound("Link not found");
      const upd = { ...link, status: "Revoked", revokedAt: nowIso() };
      await putItem("CaregiverLinks", upd);
      await audit({ actor: caller.sub, actorRole: caller.role, action: "caregiver.revoke", entity: `patient#${caller.sub}`, before: link, after: upd });
      return upd;
    },
  },
];
