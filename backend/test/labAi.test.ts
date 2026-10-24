import { test } from "node:test";
import assert from "node:assert/strict";
import { ageFrom, labAiPrompt, sanitizeLabAi } from "../src/domain/labAi.js";
import type { ResultRow } from "../src/domain/labs.js";

const row = (name: string, value: number, flag: ResultRow["flag"]): ResultRow => ({ code: "CBC", key: name, name, unit: "g/dL", value, low: 12, high: 16, flag });
const NOW = "2026-10-24T10:00:00.000Z";

test("age is computed from date of birth, null when missing or invalid", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  assert.equal(ageFrom("1960-10-25", now), 65);
  assert.equal(ageFrom("1960-10-24", now), 66);
  assert.equal(ageFrom(undefined, now), null);
  assert.equal(ageFrom("not a date", now), null);
});

test("prompt is de-identified and carries results, medicines and allergies", () => {
  const p = labAiPrompt({
    age: 66, sex: "Male", conditions: ["Atrial fibrillation"], allergies: [{ substance: "penicillin", reaction: "Rash" }],
    medicines: [{ name: "Warfarin", strength: "5 mg", dose: "1 tablet", frequency: "once daily" }],
    tests: ["Complete blood count"], results: [row("Haemoglobin", 9.1, "Low")], priority: "Routine",
  });
  assert.match(p, /Warfarin 5 mg/);
  assert.match(p, /penicillin \(Rash\)/);
  assert.match(p, /"flag":"Low"/);
  assert.doesNotMatch(p, /name|email|phone|address/i);
});

test("sanitize keeps well-formed parts and clips bad urgency to Routine", () => {
  const r = sanitizeLabAi({
    summary: "Mild anaemia.", findings: [{ finding: "Low haemoglobin", significance: "Possible blood loss on warfarin" }, { nope: 1 }],
    suggestions: [{ action: "Repeat CBC in 2 weeks", rationale: "Confirm trend", urgency: "Whenever" }], followUpTests: ["Ferritin", 5], cautions: [],
  }, [row("Haemoglobin", 9.1, "Low")], "m", NOW);
  assert.ok(r);
  assert.equal(r!.findings.length, 1);
  assert.equal(r!.suggestions[0].urgency, "Routine");
  assert.deepEqual(r!.followUpTests, ["Ferritin"]);
});

test("a critical value always produces a caution when the model gave no Immediate step", () => {
  const r = sanitizeLabAi({ summary: "Low potassium.", suggestions: [{ action: "Diet advice", urgency: "Routine" }] },
    [{ code: "LFT", key: "k", name: "Potassium", unit: "mmol/L", value: 2.4, flag: "Critical low" }], "m", NOW);
  assert.match(r!.cautions[0], /Critical value: Potassium 2.4/);
});

test("unusable replies return null", () => {
  assert.equal(sanitizeLabAi(null, [], "m", NOW), null);
  assert.equal(sanitizeLabAi({ findings: [] }, [], "m", NOW), null);
});
