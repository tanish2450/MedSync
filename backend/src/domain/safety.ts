import type { Alert, Allergy, Drug, InteractionRecord } from "../lib/types.js";
import { checkAllergies } from "./allergy.js";
import { checkDuplicates } from "./duplicates.js";
import { findInteractions, severityRank, toRef, type DrugRef } from "./interactions.js";

export interface SafetyInput {
  allergies: Allergy[];
  newDrugs: Drug[];
  activeDrugs: Drug[];                       // all active medicines, across ALL doctors
  interactions: InteractionRecord[];
}

/** Deterministic safety pipeline: allergy -> duplicate -> interaction. No LLM decisions. */
export function runSafetyChecks(inp: SafetyInput): Alert[] {
  const newRefs: DrugRef[] = inp.newDrugs.map(toRef);
  const activeRefs: DrugRef[] = inp.activeDrugs.map(toRef);
  const lookup = new Map(inp.interactions.map((r) => [r.pairKey, r]));
  const brands = Object.fromEntries(inp.newDrugs.map((d) => [d.drugId, d.brandNames]));
  const rank = (a: Alert) => a.type === "allergy" ? 10 : a.type === "interaction" ? severityRank(a.severity as string) + 1 : 0;
  return [
    ...checkAllergies(inp.allergies, newRefs, brands),
    ...findInteractions(newRefs, activeRefs, lookup),
    ...checkDuplicates(newRefs, activeRefs),
  ].sort((a, b) => rank(b) - rank(a));
}

/** Server-side gate: every alert needing acknowledgement must be acknowledged with a reason. */
export function unacknowledged(alerts: Alert[], acks: { key: string; reason: string }[] | undefined): Alert[] {
  const ok = new Set((acks ?? []).filter((a) => a.reason && a.reason.trim().length >= 3).map((a) => a.key));
  return alerts.filter((a) => a.requiresAck && !ok.has(a.key));
}
