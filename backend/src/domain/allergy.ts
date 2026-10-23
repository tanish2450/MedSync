import type { Alert, Allergy } from "../lib/types.js";
import { norm, type DrugRef } from "./interactions.js";

/** Match a recorded allergy against a drug's ingredient names, drug name, or class tokens. */
export function checkAllergies(allergies: Allergy[], drugs: DrugRef[], brandsByDrug: Record<string, string[]> = {}): Alert[] {
  const alerts: Alert[] = [];
  for (const d of drugs) {
    const tokens = new Set<string>([norm(d.name), ...d.ingredients, ...d.classes, ...(brandsByDrug[d.drugId] ?? []).map(norm)]);
    for (const a of allergies) {
      const s = norm(a.substance);
      if (!s || !tokens.has(s)) continue;
      alerts.push({
        key: `al:${d.drugId}:${s}`, type: "allergy", severity: "Allergy", drugs: [d.name],
        title: `Recorded allergy to "${a.substance}" matches ${d.name}`,
        effect: a.reaction ? `Recorded reaction: ${a.reaction}` : undefined,
        recommendation: "Choose an alternative, or override with a documented reason.",
        source: "Patient allergy record", requiresAck: true,
      });
    }
  }
  return alerts;
}
