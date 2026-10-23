import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { badRequest, HttpError } from "../lib/http.js";
import { deleteItem, putItem } from "../lib/db.js";
import { audit } from "../lib/audit.js";
import { addUserToGroup } from "../lib/cognito.js";
import { nowIso } from "../lib/services.js";
import {
  SIGNUP_ROLES, validateCaregiver, validateDoctor, validatePatient, validatePharmacy, type SignupRole,
} from "../domain/signup.js";

const DEFAULT_HOURS = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "17:00" }]]));

/**
 * POST /signup/complete. Caller is authenticated by Cognito but has no group yet (self sign-up, email or Google).
 * The role is only chosen here and is added to Cognito LAST, so a half-finished sign-up never grants access.
 * Doctors and pharmacies are auto-approved but flagged verified:false so the UI can show an "Unverified" badge until an admin verifies.
 */
export async function signupComplete(event: APIGatewayProxyEvent, body: any) {
  const c = (event.requestContext.authorizer?.claims ?? {}) as Record<string, string>;
  const sub = c.sub; const email = c.email;
  if (!sub || !email) throw new HttpError(401, "Not signed in");
  if (c["cognito:groups"]) throw new HttpError(409, "This account is already set up");
  const role = body?.role as SignupRole;
  if (!SIGNUP_ROLES.includes(role)) throw badRequest("Choose a valid role", { fields: { role: "Choose a valid role" } });
  const today = nowIso().slice(0, 10);
  const now = nowIso();

  let name: string; let user: Record<string, unknown>; let extra: (() => Promise<void>) | undefined; let cleanup: (() => Promise<void>) | undefined;
  if (role === "patient") {
    const v = validatePatient(body, today); name = v.name;
    user = { id: sub, role, name, email, phone: v.phone, language: v.language, status: "active", createdAt: now, signup: "self" };
    extra = () => putItem("Patients", {
      id: sub, name, email, phone: v.phone, dob: v.dob, gender: v.gender, address: v.address, bloodGroup: v.bloodGroup, language: v.language,
      emergencyContact: v.emergencyContact, guardian: v.guardian, isMinor: v.isMinor, assignedDoctors: [], allergies: v.allergies, conditions: v.conditions,
      active: true, createdAt: now, updatedAt: now,
    });
    cleanup = () => deleteItem("Patients", { id: sub });
  } else if (role === "doctor") {
    const v = validateDoctor(body); name = v.name;
    user = { id: sub, role, name, email, phone: v.phone, language: "en", status: "active", createdAt: now, signup: "self" };
    extra = () => putItem("Doctors", {
      id: sub, name, email, phone: v.phone, specialty: v.specialty, registrationNo: v.registrationNo, registrationCouncil: v.registrationCouncil,
      qualifications: v.qualifications, experienceYears: v.experienceYears, languages: v.languages, fee: v.fee,
      hospitalName: v.hospitalName, hospitalAddress: v.hospitalAddress, hospitalCity: v.hospitalCity, hospitalPhone: v.hospitalPhone,
      clinic: { name: v.hospitalName, address: `${v.hospitalAddress}, ${v.hospitalCity}`, lat: v.lat, lng: v.lng },
      availability: { slotMinutes: 30, weeklyHours: DEFAULT_HOURS, breaks: [], leaveDates: [] },
      onlineStatus: "Offline", active: true, googleCalendarConnected: false, verified: false, createdAt: now,
    });
    cleanup = () => deleteItem("Doctors", { id: sub });
  } else if (role === "pharmacy") {
    const v = validatePharmacy(body); name = v.staffName;
    const pharmacyId = randomUUID();
    user = { id: sub, role, name, email, phone: v.phone, language: "en", status: "active", pharmacyId, createdAt: now, signup: "self" };
    extra = () => putItem("Pharmacies", {
      id: pharmacyId, name: v.pharmacyName, address: `${v.address}, ${v.city}`, city: v.city, lat: v.lat, lng: v.lng, hours: v.hours, phone: v.pharmacyPhone,
      licenceNo: v.licenceNo, gstin: v.gstin, pharmacistName: v.pharmacistName, pharmacistRegNo: v.pharmacistRegNo,
      staffIds: [sub], active: true, verified: false, createdAt: now,
    });
    cleanup = () => deleteItem("Pharmacies", { id: pharmacyId });
  } else {
    const v = validateCaregiver(body); name = v.name;
    user = { id: sub, role, name, email, phone: v.phone, language: v.language, status: "active", createdAt: now, signup: "self" };
  }

  // Claim the account first (conditional) so a double-submit cannot create two profiles.
  try { await putItem("Users", user, "attribute_not_exists(id)"); }
  catch (e: any) { if (e?.name === "ConditionalCheckFailedException") throw new HttpError(409, "This account is already set up"); throw e; }
  try {
    await extra?.();
    await addUserToGroup(email, role);
    await audit({ actor: sub, actorRole: role, action: "signup.complete", entity: `${role}#${sub}`, after: { role, name }, meta: { verified: role === "doctor" || role === "pharmacy" ? false : undefined } });
  } catch (e) {
    await cleanup?.().catch(() => undefined);
    await deleteItem("Users", { id: sub }).catch(() => undefined);
    throw e;
  }
  return { role, name, verified: role === "doctor" || role === "pharmacy" ? false : true };
}

