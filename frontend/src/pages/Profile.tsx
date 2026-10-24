import { useState } from "react";
import { get, put } from "../api";
import { useAuth } from "../auth";
import { Avatar, Badge, ErrorBox, fmtDate, useLoad } from "../components";

const ROLE_LABEL: Record<string, string> = { patient: "Patient", doctor: "Doctor", pharmacy: "Pharmacy staff", lab: "Lab staff", caregiver: "Caregiver", admin_nurse: "Admin / Nurse" };
const Row = ({ k, v }: { k: string; v?: React.ReactNode }) => (v === undefined || v === null || v === "" ? null : <div className="prow"><span className="muted">{k}</span><span>{v}</span></div>);
const age = (dob?: string) => { if (!dob) return ""; const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return `${a} years`; };

export default function Profile() {
  const { me } = useAuth();
  const { data, error, reload } = useLoad(() => get<any>("/profile"));
  const [edit, setEdit] = useState(false); const [f, setF] = useState<any>({}); const [err, setErr] = useState<unknown>(null); const [ok, setOk] = useState("");
  if (error) return <ErrorBox e={error} />;
  if (!data) return <p>Loading…</p>;
  const { role, record: r, pharmacy: ph, user } = data;
  const start = () => {
    setF({ phone: r?.phone ?? user?.phone ?? "", address: r?.address ?? "", language: r?.language ?? user?.language ?? "", fee: r?.fee ?? "", qualifications: r?.qualifications ?? "",
      experienceYears: r?.experienceYears ?? "", consultationHours: r?.consultationHours ?? "", hospitalPhone: r?.hospitalPhone ?? "", ecName: r?.emergencyContact?.name ?? "", ecPhone: r?.emergencyContact?.phone ?? "",
      ecRelation: r?.emergencyContact?.relation ?? "", hours: ph?.hours ?? "", pharmPhone: ph?.phone ?? "" });
    setEdit(true); setOk(""); setErr(null);
  };
  const save = async () => {
    setErr(null);
    const body: any = { phone: f.phone };
    if (role === "patient") Object.assign(body, { address: f.address, emergencyContact: { name: f.ecName, phone: f.ecPhone, relation: f.ecRelation || undefined } });
    if (role === "doctor") Object.assign(body, { fee: Number(f.fee), qualifications: f.qualifications, experienceYears: f.experienceYears === "" ? undefined : Number(f.experienceYears), consultationHours: f.consultationHours || undefined, hospitalPhone: f.hospitalPhone });
    if (role === "pharmacy") body.pharmacy = { hours: f.hours, phone: f.pharmPhone };
    try { await put("/profile", body); setEdit(false); setOk("Profile updated."); reload(); } catch (e) { setErr(e); }
  };
  const inp = (k: string, label: string, type = "text") => <div className="fld" key={k}><label>{label}</label><input type={type} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>;
  return (
    <div className="narrow">
      <div className="row" style={{ gap: 16, alignItems: "center" }}>
        <Avatar name={data.name || data.email} />
        <div><h1 style={{ margin: 0 }}>{data.name}</h1><div className="muted">{ROLE_LABEL[role]} · {data.email}</div>
          {(role === "doctor" && r) && <Badge v={r.verified ? "Confirmed" : "Pending"} />}{(role === "pharmacy" && ph) && <Badge v={ph.verified ? "Confirmed" : "Pending"} />}
          {((role === "doctor" && r) || (role === "pharmacy" && ph)) && <span className="muted"> {(r ?? ph).verified ? "Verified" : "Unverified — awaiting admin check"}</span>}</div>
      </div>
      {ok && <div className="success gap">{ok}</div>}

      <div className="card gap"><h2>Account</h2>
        <Row k="Name" v={data.name} /><Row k="Email" v={data.email} /><Row k="Role" v={ROLE_LABEL[role]} /><Row k="Phone" v={r?.phone ?? user?.phone} /><Row k="Member since" v={user?.createdAt ? fmtDate(user.createdAt) : undefined} />
      </div>

      {role === "patient" && r && <div className="card"><h2>Personal &amp; health</h2>
        <Row k="Date of birth" v={r.dob ? `${fmtDate(r.dob)} (${age(r.dob)})` : undefined} /><Row k="Gender" v={r.gender} /><Row k="Blood group" v={r.bloodGroup} /><Row k="Language" v={r.language} /><Row k="Address" v={r.address} />
        <Row k="Emergency contact" v={r.emergencyContact ? `${r.emergencyContact.name} · ${r.emergencyContact.phone}${r.emergencyContact.relation ? ` (${r.emergencyContact.relation})` : ""}` : undefined} />
        {r.guardian && <Row k="Guardian" v={`${r.guardian.name} · ${r.guardian.phone} (${r.guardian.relation})`} />}
        <Row k="Allergies" v={r.allergies?.length ? r.allergies.map((a: any) => a.substance).join(", ") : "None recorded"} /><Row k="Conditions" v={r.conditions?.length ? r.conditions.join(", ") : "None recorded"} />
      </div>}

      {role === "doctor" && r && <div className="card"><h2>Professional</h2>
        <Row k="Specialty" v={r.specialty} /><Row k="Qualifications" v={r.qualifications} /><Row k="Experience" v={r.experienceYears !== undefined ? `${r.experienceYears} years` : undefined} />
        <Row k="Registration" v={`${r.registrationNo}${r.registrationCouncil ? ` · ${r.registrationCouncil}` : ""}`} /><Row k="Languages" v={r.languages?.join(", ")} /><Row k="Consultation fee" v={`₹${r.fee}`} />
        <Row k="Hospital / clinic" v={r.hospitalName ?? r.clinic?.name} /><Row k="Address" v={r.hospitalAddress ?? r.clinic?.address} /><Row k="Hospital phone" v={r.hospitalPhone} />
      </div>}

      {role === "pharmacy" && ph && <div className="card"><h2>Pharmacy</h2>
        <Row k="Name" v={ph.name} /><Row k="Address" v={ph.address} /><Row k="Phone" v={ph.phone} /><Row k="Hours" v={ph.hours} /><Row k="Drug licence" v={ph.licenceNo} /><Row k="GSTIN" v={ph.gstin} /><Row k="Pharmacist" v={ph.pharmacistName ? `${ph.pharmacistName} (${ph.pharmacistRegNo})` : undefined} />
      </div>}

      {!edit ? <button className="gap" onClick={start}>Edit contact details</button> : (
        <div className="card gap"><h2>Edit details</h2><div className="grid2">
          {inp("phone", "Phone (+91…)", "tel")}
          {role === "patient" && <>{inp("address", "Address")}{inp("ecName", "Emergency contact name")}{inp("ecPhone", "Emergency contact phone", "tel")}{inp("ecRelation", "Relation")}</>}
          {role === "doctor" && <>{inp("fee", "Consultation fee (INR)", "number")}{inp("qualifications", "Qualifications")}{inp("experienceYears", "Years of experience", "number")}{inp("consultationHours", "Consultation hours note")}{inp("hospitalPhone", "Hospital phone", "tel")}</>}
          {role === "pharmacy" && <>{inp("hours", "Opening hours")}{inp("pharmPhone", "Pharmacy phone", "tel")}</>}
        </div><p className="muted">Name, date of birth, registration and licence details can only be changed by an admin, to keep records trustworthy.</p>
          <ErrorBox e={err} /><div className="row gap"><button className="primary" onClick={save}>Save</button><button onClick={() => setEdit(false)}>Cancel</button></div></div>)}
      <span hidden>{me?.sub}</span>
    </div>
  );
}
