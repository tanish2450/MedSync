import { useMemo, useState } from "react";
import { useAuth } from "../auth";
import { post, ApiError } from "../api";
import { ErrorBox } from "../components";

export type SignupRole = "patient" | "doctor" | "pharmacy" | "caregiver" | "lab";
const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
const LANGUAGES = ["English", "Hindi", "Kannada", "Tamil", "Telugu", "Malayalam", "Marathi", "Bengali"];
const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"];
const RELATIONS = ["Spouse", "Parent", "Child", "Sibling", "Relative", "Friend", "Other"];
const SPECIALTIES = ["General Medicine", "Cardiology", "Diabetology", "Endocrinology", "Neurology", "Psychiatry", "Pulmonology", "Gastroenterology", "Orthopaedics", "Dermatology", "Paediatrics", "Gynaecology", "ENT", "Ophthalmology", "Nephrology", "Oncology", "Other"];

type F = { k: string; label: string; type?: "text" | "tel" | "date" | "number" | "select" | "textarea" | "multi" | "check"; options?: string[]; optionLabels?: Record<string, string>; hint?: string; optional?: boolean; full?: boolean };
const LAB_TESTS: Record<string, string> = { CBC: "Complete blood count", FBS: "Fasting blood sugar", HBA1C: "HbA1c", LIPID: "Lipid profile", KFT: "Kidney function", LFT: "Liver function", TFT: "Thyroid profile", INR: "PT / INR", VITD: "Vitamin D", URINE: "Urine routine" };
const PHONE_HINT = "Include country code, e.g. +919876543210";

const FIELDS: Record<SignupRole, { title: string; fields: F[] }[]> = {
  patient: [
    { title: "About you", fields: [
      { k: "name", label: "Full name" }, { k: "dob", label: "Date of birth", type: "date" }, { k: "gender", label: "Gender", type: "select", options: GENDERS },
      { k: "phone", label: "Mobile number", type: "tel", hint: PHONE_HINT }, { k: "bloodGroup", label: "Blood group", type: "select", options: BLOODS },
      { k: "language", label: "Preferred language", type: "select", options: LANGUAGES }, { k: "address", label: "Home address", type: "textarea", full: true },
    ] },
    { title: "Emergency contact", fields: [
      { k: "emergencyName", label: "Contact name" }, { k: "emergencyPhone", label: "Contact phone", type: "tel", hint: PHONE_HINT },
      { k: "emergencyRelation", label: "Relation", type: "select", options: RELATIONS },
    ] },
    { title: "Health basics (you can edit later)", fields: [
      { k: "allergies", label: "Known allergies (comma separated)", type: "textarea", optional: true, full: true, hint: "e.g. Penicillin, Sulfa. Used to warn doctors before prescribing." },
      { k: "conditions", label: "Existing conditions (comma separated)", type: "textarea", optional: true, full: true },
    ] },
  ],
  doctor: [
    { title: "About you", fields: [
      { k: "name", label: "Full name" }, { k: "phone", label: "Mobile number", type: "tel", hint: PHONE_HINT },
      { k: "specialty", label: "Specialty", type: "select", options: SPECIALTIES }, { k: "qualifications", label: "Qualifications", hint: "e.g. MBBS, MD (Medicine)" },
      { k: "experienceYears", label: "Years of experience", type: "number" }, { k: "fee", label: "Consultation fee (INR)", type: "number" },
      { k: "languages", label: "Languages you consult in", type: "multi", options: LANGUAGES, full: true },
    ] },
    { title: "Medical registration", fields: [
      { k: "registrationNo", label: "Registration number", hint: "As on your medical council certificate" },
      { k: "registrationCouncil", label: "Registering medical council", hint: "e.g. Karnataka Medical Council" },
    ] },
    { title: "Hospital / clinic", fields: [
      { k: "hospitalName", label: "Hospital / clinic name" }, { k: "hospitalCity", label: "City" },
      { k: "hospitalAddress", label: "Address", type: "textarea", full: true }, { k: "hospitalPhone", label: "Hospital phone", type: "tel", hint: PHONE_HINT },
      { k: "lat", label: "Latitude", type: "number", hint: "Use the location button below" }, { k: "lng", label: "Longitude", type: "number" },
    ] },
  ],
  pharmacy: [
    { title: "Your details", fields: [{ k: "name", label: "Your full name" }, { k: "phone", label: "Your mobile number", type: "tel", hint: PHONE_HINT }] },
    { title: "Pharmacy", fields: [
      { k: "pharmacyName", label: "Pharmacy name" }, { k: "licenceNo", label: "Drug licence number" }, { k: "gstin", label: "GSTIN", optional: true },
      { k: "pharmacyPhone", label: "Pharmacy phone", type: "tel", hint: PHONE_HINT }, { k: "hours", label: "Opening hours", hint: "e.g. 08:00-22:00" }, { k: "city", label: "City" },
      { k: "address", label: "Address", type: "textarea", full: true },
      { k: "pharmacistName", label: "Registered pharmacist name" }, { k: "pharmacistRegNo", label: "Pharmacist registration number" },
      { k: "lat", label: "Latitude", type: "number", hint: "Use the location button below" }, { k: "lng", label: "Longitude", type: "number" },
    ] },
  ],
  lab: [
    { title: "Your details", fields: [{ k: "name", label: "Your full name" }, { k: "phone", label: "Your mobile number", type: "tel", hint: PHONE_HINT }] },
    { title: "Lab", fields: [
      { k: "labName", label: "Lab name" }, { k: "licenceNo", label: "Lab registration / licence number" }, { k: "accreditation", label: "Accreditation (e.g. NABL number)", optional: true },
      { k: "labPhone", label: "Lab phone", type: "tel", hint: PHONE_HINT }, { k: "hours", label: "Opening hours", hint: "e.g. 07:00-21:00" }, { k: "city", label: "City" },
      { k: "address", label: "Address", type: "textarea", full: true },
      { k: "tests", label: "Tests you offer", type: "multi", options: Object.keys(LAB_TESTS), optionLabels: LAB_TESTS, full: true },
      { k: "homeCollection", label: "We offer home sample collection", type: "check", full: true, optional: true },
      { k: "lat", label: "Latitude", type: "number", hint: "Use the location button below" }, { k: "lng", label: "Longitude", type: "number" },
    ] },
  ],
  caregiver: [
    { title: "About you", fields: [
      { k: "name", label: "Full name" }, { k: "phone", label: "Mobile number", type: "tel", hint: PHONE_HINT }, { k: "language", label: "Preferred language", type: "select", options: LANGUAGES },
    ] },
  ],
};
const GUARDIAN: F[] = [
  { k: "guardianName", label: "Parent / guardian name" }, { k: "guardianPhone", label: "Guardian phone", type: "tel", hint: PHONE_HINT },
  { k: "guardianRelation", label: "Relation", type: "select", options: RELATIONS }, { k: "guardianEmail", label: "Guardian email", optional: true },
];

const ageOf = (dob: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
};
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ProfileForm({ role, defaultName }: { role: SignupRole; defaultName?: string }) {
  const { refresh } = useAuth();
  const [v, setV] = useState<Record<string, any>>({ name: defaultName ?? "", languages: ["English"], consent: false });
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [locMsg, setLocMsg] = useState("");
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));
  const age = role === "patient" ? ageOf(v.dob ?? "") : null;
  const isMinor = age !== null && age < 18;
  const sections = useMemo(() => {
    const s = FIELDS[role].map((x) => ({ ...x }));
    if (isMinor) s.splice(2, 0, { title: "Parent / guardian (required under 18)", fields: GUARDIAN });
    return s;
  }, [role, isMinor]);

  const locate = () => {
    if (!navigator.geolocation) return setLocMsg("Your browser cannot share location. Enter latitude and longitude manually.");
    setLocMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => { set("lat", Number(p.coords.latitude.toFixed(5))); set("lng", Number(p.coords.longitude.toFixed(5))); setLocMsg("Location filled in."); },
      () => setLocMsg("Could not get location. Allow location access or enter it manually."), { timeout: 10000 });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setFieldErr({});
    const body: Record<string, any> = { ...v, role };
    if (role === "patient") {
      body.allergies = splitList(v.allergies ?? "").map((substance) => ({ substance }));
      body.conditions = splitList(v.conditions ?? "");
    }
    try { await post("/signup/complete", body); await refresh(); }
    catch (x) {
      if (x instanceof ApiError && x.details?.fields) { setFieldErr(x.details.fields); setErr("Please fix the highlighted fields."); }
      else setErr(x);
    } finally { setBusy(false); }
  };

  const render = (f: F) => {
    const val = v[f.k] ?? ""; const bad = fieldErr[f.k];
    return (
      <div key={f.k} className={`fld${f.full ? " full" : ""}`}>
        <label htmlFor={`f-${f.k}`}>{f.label}{f.optional ? " (optional)" : ""}</label>
        {f.type === "select" ? (
          <select id={`f-${f.k}`} value={val} onChange={(e) => set(f.k, e.target.value)} required={!f.optional}><option value="">Select…</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
        ) : f.type === "textarea" ? (
          <textarea id={`f-${f.k}`} rows={2} value={val} onChange={(e) => set(f.k, e.target.value)} required={!f.optional} />
        ) : f.type === "multi" ? (
          <div className="chips">{f.options!.map((o) => {
            const on = (v[f.k] ?? []).includes(o);
            return <button type="button" key={o} className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => set(f.k, on ? v[f.k].filter((x: string) => x !== o) : [...(v[f.k] ?? []), o])}>{f.optionLabels?.[o] ?? o}</button>;
          })}</div>
        ) : f.type === "check" ? (
          <label className="check" style={{ margin: 0 }}><input id={`f-${f.k}`} type="checkbox" checked={!!v[f.k]} onChange={(e) => set(f.k, e.target.checked)} /> Yes</label>
        ) : (
          <input id={`f-${f.k}`} type={f.type ?? "text"} value={val} required={!f.optional} step={f.type === "number" ? "any" : undefined}
            max={f.type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
            onChange={(e) => set(f.k, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />
        )}
        {bad ? <small className="err">{bad}</small> : f.hint ? <small className="muted">{f.hint}</small> : null}
      </div>
    );
  };
  return (
    <form className="card signup" onSubmit={submit}>
      {sections.map((s) => <fieldset key={s.title}><legend>{s.title}</legend><div className="grid2">{s.fields.map(render)}</div></fieldset>)}
      {(role === "doctor" || role === "pharmacy" || role === "lab") && <div className="row" style={{ gap: 10 }}><button type="button" className="sm" onClick={locate}>Use my current location</button><small className="muted">{locMsg}</small></div>}
      {isMinor && <p className="muted">You are under 18, so a parent or guardian must be listed. They will be your point of contact for medication reminders.</p>}
      {(role === "doctor" || role === "pharmacy" || role === "lab") && <p className="muted">Your account is active straight away and shown to patients as <b>Unverified</b> until a MedSync admin checks your registration details.</p>}
      <label className="check"><input type="checkbox" checked={!!v.consent} onChange={(e) => set("consent", e.target.checked)} /> I confirm these details are accurate and I consent to MedSync processing my health information to provide this service.</label>
      {fieldErr.consent && <small className="err">{fieldErr.consent}</small>}
      <ErrorBox e={err} />
      <button className="primary gap" disabled={busy}>{busy ? "Creating your profile…" : "Create my profile"}</button>
    </form>
  );
}
