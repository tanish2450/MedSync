import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResults, canCancelLab, canChooseLab, canEnterResults, flagValue, labNext, testByCode, validateLab } from "../src/domain/labs.js";

test("critical limits win over the normal range", () => {
  const r = { low: 3.5, high: 5.1, critLow: 2.8, critHigh: 6.2 };
  assert.equal(flagValue(4.2, r), "Normal");
  assert.equal(flagValue(5.5, r), "High");
  assert.equal(flagValue(6.4, r), "Critical high");
  assert.equal(flagValue(3.0, r), "Low");
  assert.equal(flagValue(2.5, r), "Critical low");
  assert.equal(flagValue(250, { high: 200 }), "High");
  assert.equal(flagValue(30, { low: 40 }), "Low");
});
test("lab status flow: collect, process, then results; cancel and lab choice only before collection", () => {
  assert.deepEqual(labNext("Ordered"), ["Sample collected"]);
  assert.deepEqual(labNext("Sample collected"), ["Processing"]);
  assert.deepEqual(labNext("Processing"), []);
  assert.ok(!canEnterResults("Ordered") && canEnterResults("Sample collected") && canEnterResults("Processing") && !canEnterResults("Report ready"));
  assert.ok(canCancelLab("Ordered") && !canCancelLab("Sample collected"));
  assert.ok(canChooseLab("Ordered") && !canChooseLab("Processing"));
});
test("results: every analyte is required, values are flagged, a lab range overrides the default", () => {
  const rows = buildResults(["FBS", "INR"], [
    { code: "FBS", key: "fbs", value: "126" },
    { code: "INR", key: "inr", value: 5.4 },
  ]);
  assert.equal(rows.find((r) => r.key === "fbs")!.flag, "High");
  assert.equal(rows.find((r) => r.key === "inr")!.flag, "Critical high");
  // lab-supplied range wins for the normal band
  const own = buildResults(["FBS"], [{ code: "FBS", key: "fbs", value: 105, low: 70, high: 110 }]);
  assert.equal(own[0].flag, "Normal"); assert.equal(own[0].high, 110);
  assert.throws(() => buildResults(["CBC"], [{ code: "CBC", key: "hb", value: 13 }]), (e: any) => e.missing.length === 2);
  assert.throws(() => buildResults(["FBS"], [{ code: "FBS", key: "fbs", value: "abc" }]), (e: any) => /not a number/.test(e.missing[0]));
});
test("text analytes are stored as reported", () => {
  const rows = buildResults(["URINE"], [{ code: "URINE", key: "protein", value: "Trace" }, { code: "URINE", key: "sugar", value: "Nil" }, { code: "URINE", key: "pus", value: 8 }]);
  assert.equal(rows[0].flag, "Reported"); assert.equal(rows[2].flag, "High");
});
test("lab sign-up needs licence, location and at least one known test", () => {
  const ok = { name: "Asha", phone: "+919876543210", labName: "Asha Labs", licenceNo: "KA/LAB/123", address: "12 MG Road", city: "Bengaluru", labPhone: "+918012345678", hours: "7am-9pm", lat: 12.97, lng: 77.6, tests: ["CBC", "NOPE"], consent: true };
  assert.deepEqual(validateLab(ok).tests, ["CBC"]);
  assert.throws(() => validateLab({ ...ok, tests: ["NOPE"] }), (e: any) => !!e.details?.fields?.tests);
  assert.throws(() => validateLab({ ...ok, licenceNo: "x" }), (e: any) => !!e.details?.fields?.licenceNo);
  assert.ok(testByCode("LIPID")?.fasting);
});
