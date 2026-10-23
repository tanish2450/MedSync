import type { Drug, InteractionRecord, Severity } from "../lib/types.js";
import { pairKey } from "../domain/interactions.js";

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseCatalogue(text: string): Drug[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((line) => {
    const [generic, ingredients, classes, forms, brands, critical] = line.split("|");
    return {
      drugId: slug(generic), genericName: generic,
      ingredients: ingredients.split(";").map((s) => s.trim().toLowerCase()),
      classes: classes.split(";").map((s) => s.trim().toLowerCase()),
      brandNames: brands ? brands.split(";").map((s) => s.trim()).filter(Boolean) : [],
      forms: forms.split(",").map((f) => {
        const i = f.indexOf(":");
        return { form: f.slice(0, i).trim(), strengths: f.slice(i + 1).split("/").map((s) => s.trim()) };
      }),
      criticalDrug: critical === "1",
    } satisfies Drug;
  });
}

interface RawPair { a: string; b: string; severity: Severity; mechanism: string; effect: string; recommendation: string }
interface Dataset { dataset: string; limitations: string; pairs: RawPair[] }

/** Expand "@class" rules into ingredient-pair records. Ingredient-level pairs are the only keys looked up at runtime. */
export function expandInteractions(ds: Dataset, catalogue: Drug[]): InteractionRecord[] {
  const byIngredient = (token: string): string[] => {
    if (token.startsWith("@")) {
      const cls = token.slice(1);
      return [...new Set(catalogue.filter((d) => d.classes.includes(cls)).flatMap((d) => d.ingredients))];
    }
    return [token.toLowerCase()];
  };
  const known = new Set(catalogue.flatMap((d) => d.ingredients));
  const out = new Map<string, InteractionRecord>();
  for (const p of ds.pairs) {
    for (const x of byIngredient(p.a)) for (const y of byIngredient(p.b)) {
      if (x === y) continue;
      if (!known.has(x) || !known.has(y)) throw new Error(`Interaction references unknown ingredient: ${x} / ${y}`);
      const key = pairKey(x, y);
      const existing = out.get(key);
      const rec: InteractionRecord = {
        pairKey: key, ingredientA: x, ingredientB: y, severity: p.severity, mechanism: p.mechanism,
        effect: p.effect, recommendation: p.recommendation, source: ds.dataset,
      };
      // Most specific (ingredient-level) pair wins over class-level; otherwise keep the higher severity.
      if (!existing || (!p.a.startsWith("@") && !p.b.startsWith("@")) || sevRank(p.severity) > sevRank(existing.severity)) out.set(key, rec);
    }
  }
  return [...out.values()];
}
const sevRank = (s: Severity) => ["Minor", "Moderate", "Major", "Contraindicated"].indexOf(s);
