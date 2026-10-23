import type { Alert } from "../lib/types.js";
import { type DrugRef } from "./interactions.js";

/** Warn if the same active ingredient or the same therapeutic group (first class token) is already active. */
export function checkDuplicates(newDrugs: DrugRef[], activeDrugs: DrugRef[]): Alert[] {
  const alerts: Alert[] = []; const seen = new Set<string>();
  const compare = (n: DrugRef, o: DrugRef) => {
    if (n.drugId === o.drugId && n !== o) { /* same drug id: still duplicate */ }
    const sharedIngredient = n.ingredients.find((i) => o.ingredients.includes(i));
    const sameGroup = n.classes[0] && n.classes[0] === o.classes[0];
    if (!sharedIngredient && !sameGroup) return;
    const key = `dup:${[n.drugId, o.drugId].sort().join("+")}`;
    if (seen.has(key)) return; seen.add(key);
    alerts.push({
      key, type: "duplicate", severity: "Duplicate", drugs: [n.name, o.name],
      title: sharedIngredient
        ? `Duplicate ingredient (${sharedIngredient}): ${n.name} and ${o.name}`
        : `Duplicate therapy class (${n.classes[0]}): ${n.name} and ${o.name}`,
      recommendation: "Confirm that therapeutic duplication is intended.",
      source: "Active medication profile", requiresAck: false,
    });
  };
  newDrugs.forEach((n, i) => {
    activeDrugs.forEach((o) => compare(n, o));
    for (let j = i + 1; j < newDrugs.length; j++) compare(n, newDrugs[j]);
  });
  return alerts;
}
