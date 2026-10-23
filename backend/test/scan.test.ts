import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraft, imageKind, matchDrug, parseModelJson, sanitizeExtraction } from "../src/domain/scan.js";
import type { Drug } from "../src/lib/types.js";

const drug = (id: string, g: string, brands: string[], forms = [{ form: "tablet", strengths: ["500 mg", "650 mg"] }]): Drug =>
  ({ drugId: id, genericName: g, ingredients: [g.toLowerCase()], classes: [], brandNames: brands, forms });
const CAT = [drug("d1", "Paracetamol", ["Dolo", "Crocin"]), drug("d2", "Metformin", ["Glycomet"], [{ form: "tablet", strengths: ["500 mg", "850 mg"] }, { form: "syrup", strengths: ["100 mg/5 ml"] }]), drug("d3", "Amoxicillin", ["Mox"], [{ form: "capsule", strengths: ["250 mg"] }])];

test("model JSON is recovered from fenced or chatty replies", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go: {"a":2} thanks'), { a: 2 });
  assert.equal(parseModelJson("no json"), null);
  assert.equal(parseModelJson("{broken"), null);
});
test("sanitise caps, nulls junk and ignores non-medicines", () => {
  const e = sanitizeExtraction({ legible: true, medicines: [{ name: "Dolo 650", strength: "650mg", frequency: "N/A", durationDays: "5" , dose: "1 tab" }, { name: null }, { name: "X", durationDays: 9999 }] });
  assert.equal(e.medicines.length, 2);
  assert.equal(e.medicines[0].frequency, null); assert.equal(e.medicines[0].durationDays, 5); assert.equal(e.medicines[1].durationDays, null);
  assert.equal(sanitizeExtraction("garbage").legible, false);
});
test("drug matching by brand/generic, ambiguous or unknown returns null", () => {
  assert.equal(matchDrug("Dolo 650 Tab", CAT)?.drugId, "d1");
  assert.equal(matchDrug("TAB. METFORMIN 500mg", CAT)?.drugId, "d2");
  assert.equal(matchDrug("Zzzcillin", CAT), null);
  assert.equal(matchDrug("ab", CAT), null);
});
test("draft flags every missing or unmatched attribute", () => {
  const ex = sanitizeExtraction({ medicines: [
    { name: "Dolo 650", strength: "650 mg", form: "tab", dose: "1 tablet", frequency: "1-0-1", durationDays: 5 },
    { name: "Metformin", strength: null, form: null, dose: null, frequency: "as per doctor", durationDays: null },
    { name: "Mystery pill", strength: "10mg" },
  ] });
  const [a, b, c] = buildDraft(ex, CAT);
  assert.deepEqual(a.missing, []); assert.equal(a.drugId, "d1"); assert.deepEqual(a.timings, ["08:00", "21:00"]);
  assert.deepEqual(b.missing.sort(), ["dose", "durationDays", "form", "frequency", "strength"].sort());
  assert.equal(b.frequencyRaw, "as per doctor");
  assert.ok(c.missing.includes("drug") && c.drugId === null);
});
test("single-form drug fills form; strength mismatch is flagged not guessed", () => {
  const [a] = buildDraft(sanitizeExtraction({ medicines: [{ name: "Amoxicillin", strength: "500 mg", dose: "1 capsule", frequency: "TDS", durationDays: 7 }] }), CAT);
  assert.equal(a.form, "capsule"); assert.equal(a.strength, null); assert.deepEqual(a.missing, ["strength"]);
});
test("image signature check", () => {
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(imageKind(Buffer.from("hello world, not an image")), null);
});
