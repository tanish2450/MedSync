import type { Alert, Drug, InteractionRecord, Severity } from "../lib/types.js";

export const norm = (s: string) => s.trim().toLowerCase();
export const pairKey = (a: string, b: string) => [norm(a), norm(b)].sort().join("#");

const SEV_ORDER: Severity[] = ["Minor", "Moderate", "Major", "Contraindicated"];
export const severityRank = (s: string) => SEV_ORDER.indexOf(s as Severity);

export interface DrugRef { drugId: string; name: string; ingredients: string[]; classes: string[] }
export const toRef = (d: Drug): DrugRef => ({ drugId: d.drugId, name: d.genericName, ingredients: d.ingredients.map(norm), classes: d.classes.map(norm) });

/** All distinct ingredient-pair keys between two drugs (deterministic, no LLM). */
export function candidatePairs(a: DrugRef, b: DrugRef): { key: string }[] {
  const keys = new Set<string>();
  for (const x of a.ingredients) for (const y of b.ingredients) if (x !== y) keys.add(pairKey(x, y));
  return [...keys].map((key) => ({ key }));
}

/**
 * Compare each new drug against (a) every active medicine across all doctors and (b) the other new drugs.
 * `lookup` returns the stored interaction record for a pair key or undefined — the dataset is the single source of truth.
 */
export function findInteractions(
  newDrugs: DrugRef[], activeDrugs: DrugRef[], lookup: Map<string, InteractionRecord>,
): Alert[] {
  const alerts: Alert[] = []; const seen = new Set<string>();
  const check = (a: DrugRef, b: DrugRef) => {
    for (const { key } of candidatePairs(a, b)) {
      const rec = lookup.get(key);
      if (!rec) continue;
      const alertKey = `ix:${[a.drugId, b.drugId].sort().join("+")}:${key}`;
      if (seen.has(alertKey)) continue; seen.add(alertKey);
      alerts.push({
        key: alertKey, type: "interaction", severity: rec.severity,
        drugs: [a.name, b.name],
        title: `${a.name} + ${b.name}: ${rec.severity} interaction`,
        mechanism: rec.mechanism, effect: rec.effect, recommendation: rec.recommendation, source: rec.source,
        requiresAck: rec.severity === "Major" || rec.severity === "Contraindicated",
      });
    }
  };
  newDrugs.forEach((n, i) => {
    for (const act of activeDrugs) if (act.drugId !== n.drugId) check(n, act);
    for (let j = i + 1; j < newDrugs.length; j++) check(n, newDrugs[j]);
  });
  return alerts.sort((x, y) => severityRank(y.severity as string) - severityRank(x.severity as string));
}

/** Neutral wording requirement: never say "safe". */
export const NO_INTERACTION_MESSAGE = "No known interaction found in our database";
