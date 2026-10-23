import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { SFNClient, StartSyncExecutionCommand } from "@aws-sdk/client-sfn";
import { ddb, getItem, query, scan, tn } from "./db.js";
import { forbidden, notFound, type Caller } from "./http.js";
import type { Alert, Drug, InteractionRecord, Patient, PrescriptionItem } from "./types.js";
import { canViewPatient } from "../domain/permissions.js";
import { activeMeds } from "../domain/versioning.js";
import { candidatePairs, toRef } from "../domain/interactions.js";
import { runSafetyChecks } from "../domain/safety.js";
import { explainAlert, rxNormConcepts } from "./ai.js";

export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST date
export const nowIso = () => new Date().toISOString();

export async function loadPatient(id: string): Promise<Patient> {
  const p = await getItem<Patient>("Patients", { id });
  if (!p) throw notFound("Patient not found");
  return p;
}

export async function assertCanViewPatient(caller: Caller, patient: Patient) {
  let caregiverLinkActive = false;
  if (caller.role === "caregiver") {
    const link = await getItem<{ status: string }>("CaregiverLinks", { patientId: patient.id, caregiverId: caller.sub });
    caregiverLinkActive = link?.status === "Active";
  }
  if (!canViewPatient({ role: caller.role, sub: caller.sub, patient, caregiverLinkActive })) throw forbidden("You do not have access to this patient");
}

export const allMedRows = (patientId: string) => query<PrescriptionItem>("PrescriptionItems", { pk: "patientId", pkValue: patientId });
export async function loadActiveMeds(patientId: string) { return activeMeds(await allMedRows(patientId), today()); }

// Drug catalogue cached per warm Lambda (a few hundred rows).
let catCache: { at: number; drugs: Drug[] } | null = null;
export async function catalogue(): Promise<Drug[]> {
  if (catCache && Date.now() - catCache.at < 300_000) return catCache.drugs;
  const drugs = await scan<Drug>("DrugCatalogue", 5000);
  catCache = { at: Date.now(), drugs };
  return drugs;
}
export async function loadDrug(drugId: string): Promise<Drug> {
  const d = await getItem<Drug>("DrugCatalogue", { drugId });
  if (!d) throw notFound(`Drug "${drugId}" is not in the catalogue`);
  return d;
}

/** Fetch stored interaction records for every candidate ingredient pair (dataset is the single source of truth). */
export async function loadInteractionsFor(newDrugs: Drug[], activeDrugs: Drug[]): Promise<InteractionRecord[]> {
  const keys = new Set<string>();
  const nr = newDrugs.map(toRef), ar = activeDrugs.map(toRef);
  nr.forEach((n, i) => {
    ar.forEach((a) => candidatePairs(n, a).forEach((p) => keys.add(p.key)));
    for (let j = i + 1; j < nr.length; j++) candidatePairs(n, nr[j]).forEach((p) => keys.add(p.key));
  });
  const list = [...keys]; const out: InteractionRecord[] = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const r = await ddb.send(new BatchGetCommand({ RequestItems: { [tn("DrugInteractions")]: { Keys: chunk.map((pairKey) => ({ pairKey })) } } }));
    out.push(...((r.Responses?.[tn("DrugInteractions")] ?? []) as InteractionRecord[]));
  }
  return out;
}

export interface CheckState {
  patientId: string; drugIds: string[]; excludeItemId?: string;
  allergies?: Patient["allergies"]; newDrugs?: Drug[]; activeDrugs?: Drug[];
  interactions?: InteractionRecord[]; alerts?: Alert[]; rxnorm?: unknown[];
}

// ---- Step Functions task bodies (also used in-process when no state machine is configured) ----
export async function stepNormalise(s: CheckState): Promise<CheckState> {
  const [patient, rows] = await Promise.all([loadPatient(s.patientId), allMedRows(s.patientId)]);
  const newDrugs = await Promise.all(s.drugIds.map(loadDrug));
  const active = activeMeds(rows, today()).filter((r) => r.itemId !== s.excludeItemId);
  const activeDrugs = await Promise.all([...new Set(active.map((r) => r.drugId))].map(loadDrug));
  const rxnorm = (await Promise.all(newDrugs.map((d) => rxNormConcepts(d.genericName)))).flat();
  return { ...s, allergies: patient.allergies, newDrugs, activeDrugs, rxnorm };
}
export async function stepInteractionLookup(s: CheckState): Promise<CheckState> {
  return { ...s, interactions: await loadInteractionsFor(s.newDrugs ?? [], s.activeDrugs ?? []) };
}
export async function stepEvaluate(s: CheckState): Promise<CheckState> {
  const alerts = runSafetyChecks({ allergies: s.allergies ?? [], newDrugs: s.newDrugs ?? [], activeDrugs: s.activeDrugs ?? [], interactions: s.interactions ?? [] });
  return { ...s, alerts };
}
export async function stepExplain(s: CheckState): Promise<CheckState> {
  const alerts = await Promise.all((s.alerts ?? []).map(async (a) => ({ ...a, explanation: await explainAlert(a) })));
  return { ...s, alerts };
}

const sfn = new SFNClient({});
/** Runs the safety workflow. Always re-run server-side at save time; never trust client-supplied alerts. */
export async function runSafetyWorkflow(input: { patientId: string; drugIds: string[]; excludeItemId?: string }): Promise<Alert[]> {
  const arn = process.env.SAFETY_STATE_MACHINE_ARN;
  if (arn) {
    const r = await sfn.send(new StartSyncExecutionCommand({ stateMachineArn: arn, input: JSON.stringify(input) }));
    if (r.status !== "SUCCEEDED") throw new Error(`Safety workflow ${r.status}: ${r.error ?? ""}`);
    return (JSON.parse(r.output ?? "{}") as CheckState).alerts ?? [];
  }
  let s: CheckState = input;
  s = await stepNormalise(s); s = await stepInteractionLookup(s); s = await stepEvaluate(s); s = await stepExplain(s);
  return s.alerts ?? [];
}
