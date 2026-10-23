import { test } from "node:test";
import assert from "node:assert/strict";
import { canCancel, orderTotal, pharmacyNext, suggestQuantity, validateLines } from "../src/domain/orders.js";

test("pharmacy status flow differs for delivery and pickup", () => {
  assert.deepEqual(pharmacyNext("Delivery", "Packed"), ["Out for delivery"]);
  assert.deepEqual(pharmacyNext("Pickup", "Packed"), ["Ready for pickup"]);
  assert.deepEqual(pharmacyNext("Delivery", "Out for delivery"), ["Delivered"]);
  assert.deepEqual(pharmacyNext("Pickup", "Ready for pickup"), ["Collected"]);
  assert.deepEqual(pharmacyNext("Delivery", "Delivered"), []);
  assert.deepEqual(pharmacyNext("Delivery", "Placed"), []);
});
test("cancel only before packing", () => {
  assert.ok(canCancel("Placed") && canCancel("Accepted"));
  assert.ok(!canCancel("Packed") && !canCancel("Delivered") && !canCancel("Declined"));
});
test("suggested quantity follows dose, frequency and days left", () => {
  const med = { dose: "1 tablet", form: "tablet", frequency: "twice daily", timings: ["08:00", "20:00"], endDate: "2026-10-29" };
  assert.equal(suggestQuantity(med, "2026-10-23"), 14);
  assert.equal(suggestQuantity({ ...med, dose: "2 tablets" }, "2026-10-23"), 28);
  assert.equal(suggestQuantity({ ...med, dose: "1/2 tablet" }, "2026-10-23"), 7);
  assert.equal(suggestQuantity({ ...med, form: "syrup" }, "2026-10-23"), 1);
  assert.equal(suggestQuantity({ ...med, frequency: "as needed", timings: undefined }, "2026-10-23"), 10);
  assert.equal(suggestQuantity({ ...med, endDate: "2026-10-01" }, "2026-10-23"), 2);
});
test("line validation", () => {
  const ok = new Set(["a", "b"]);
  assert.equal(validateLines([{ itemId: "a", quantity: 5 }], ok), null);
  assert.match(validateLines([], ok)!, /at least one/);
  assert.match(validateLines([{ itemId: "zzz", quantity: 1 }], ok)!, /prescribed/);
  assert.match(validateLines([{ itemId: "a", quantity: 0 }], ok)!, /Quantity/);
  assert.match(validateLines([{ itemId: "a", quantity: 1.5 }], ok)!, /Quantity/);
  assert.match(validateLines([{ itemId: "a", quantity: 1 }, { itemId: "a", quantity: 2 }], ok)!, /twice/);
});
test("order total only when every line is priced", () => {
  assert.equal(orderTotal([{ quantity: 10, unitPrice: 2.5 }, { quantity: 2, unitPrice: 10 }]), 45);
  assert.equal(orderTotal([{ quantity: 10, unitPrice: 2.5 }, { quantity: 2 }]), null);
});
