import { test } from "node:test";
import assert from "node:assert/strict";
import { NURSE_DESK, canUseThread, cleanText, parseThreadId, sortThreads, threadId, uniqueThreads } from "../src/domain/chat.js";

test("thread ids round-trip and reject malformed ids", () => {
  assert.deepEqual(parseThreadId(threadId("p1", "d1")), { patientId: "p1", staffKey: "d1" });
  assert.equal(parseThreadId("p1"), null);
  assert.equal(parseThreadId("p1~d1~x"), null);
});
test("patients only reach their assigned doctors and the nurse desk", () => {
  assert.ok(canUseThread("patient", "p1", { patientId: "p1", staffKey: "d1" }, ["d1"]));
  assert.ok(canUseThread("patient", "p1", { patientId: "p1", staffKey: NURSE_DESK }, []));
  assert.ok(!canUseThread("patient", "p1", { patientId: "p1", staffKey: "d2" }, ["d1"]));
  assert.ok(!canUseThread("patient", "p2", { patientId: "p1", staffKey: "d1" }, ["d1"]));
});
test("doctors only use their own thread with an assigned patient; nurses only the nurse desk", () => {
  assert.ok(canUseThread("doctor", "d1", { patientId: "p1", staffKey: "d1" }, ["d1"]));
  assert.ok(!canUseThread("doctor", "d1", { patientId: "p1", staffKey: "d1" }, ["d2"]));
  assert.ok(!canUseThread("doctor", "d1", { patientId: "p1", staffKey: "d2" }, ["d1", "d2"]));
  assert.ok(canUseThread("admin_nurse", "n1", { patientId: "p1", staffKey: NURSE_DESK }, []));
  assert.ok(!canUseThread("admin_nurse", "n1", { patientId: "p1", staffKey: "d1" }, ["d1"]));
  assert.ok(!canUseThread("caregiver", "c1", { patientId: "p1", staffKey: NURSE_DESK }, []));
});
test("emergency threads sort before all regular threads", () => {
  const out = sortThreads([
    { id: "a", lastAt: "2026-10-24T10:00:00Z" },
    { id: "b", emergency: true, lastAt: "2026-10-24T08:00:00Z" },
    { id: "c", lastAt: "2026-10-24T11:00:00Z" },
    { id: "d", emergency: true, lastAt: "2026-10-24T09:00:00Z" },
  ]).map((t) => t.id);
  assert.deepEqual(out, ["d", "b", "c", "a"]);
});
test("an inbox lists each patient once, keeping the emergency/latest thread", () => {
  const sorted = sortThreads([
    { id: "1", patientId: "p1", lastAt: "2026-10-24T10:00:00Z" },
    { id: "2", patientId: "p1", emergency: true, lastAt: "2026-10-24T08:00:00Z" },
    { id: "3", patientId: "p2", lastAt: "2026-10-24T09:00:00Z" },
  ]);
  assert.deepEqual(uniqueThreads(sorted, (t) => t.patientId).map((t) => t.id), ["2", "3"]);
});
test("message text is trimmed and bounded", () => {
  assert.equal(cleanText("  hi "), "hi");
  assert.equal(cleanText("   "), null);
  assert.equal(cleanText(5), null);
  assert.equal(cleanText("x".repeat(2001)), null);
});
