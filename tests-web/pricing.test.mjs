import test from "node:test";
import assert from "node:assert/strict";
import { priceUnit, validateQuarterlyTouchUp } from "../lib/pricing.ts";

const standard = (baseCents, extras = {}) => priceUnit({
  currency: "USD", baseCents, quantity: 1, minimumCents: 45000, ...extras,
});

test("HC-Min-01: studio one-time 400 is raised to 450, not silently passed", () => {
  const p = standard(40000);
  assert.equal(p.pricePerUnitCents, 45000);
  assert.equal(p.minimumAdjustmentCents, 5000);
});

test("HC-Min-02: 10% volume discount to studio 360 still enforces 450", () => {
  const p = standard(40000, { discountBps: 1000 });
  assert.equal(p.discountCents, 4000);
  assert.equal(p.afterDiscountCents, 36000);
  assert.equal(p.minimumAdjustmentCents, 9000);
  assert.equal(p.pricePerUnitCents, 45000);
});

test("HC-Min-03: 1BR discounted 500 to 450 meets minimum exactly", () => {
  const p = standard(50000, { discountBps: 1000 });
  assert.equal(p.pricePerUnitCents, 45000);
  assert.equal(p.minimumAdjustmentCents, 0);
});

test("HC-Min-04: 2BR discounted 600 to 540 clears minimum", () => {
  assert.equal(standard(60000, { discountBps: 1000 }).pricePerUnitCents, 54000);
});

test("HC-Heavy-01: 1BR heavy 40% surcharge equals 700 before discount", () => {
  const p = standard(50000, { surchargeBps: 4000 });
  assert.equal(p.surchargeCents, 20000);
  assert.equal(p.pricePerUnitCents, 70000);
});

test("heavy condition and volume discount follow defined order", () => {
  const p = standard(50000, { surchargeBps: 4000, discountBps: 1000 });
  assert.equal(p.subtotalCents, 70000);
  assert.equal(p.discountCents, 7000);
  assert.equal(p.pricePerUnitCents, 63000);
});

test("HC-Quarterly-01: included 475 additionally charged is blocked", () => {
  assert.throws(() => validateQuarterlyTouchUp(true, 47500), /both included/);
  assert.equal(validateQuarterlyTouchUp(true, 0), 0);
  assert.equal(validateQuarterlyTouchUp(false, 47500), 47500);
});

test("HC-Margin-01: missing direct cost produces unverified margin", () => {
  assert.equal(standard(50000).grossMarginBps, null);
  assert.equal(standard(50000, { directCostCents: 27500 }).grossMarginBps, 4500);
});

test("discount rounds deterministically at each minor-unit step", () => {
  const p = standard(5, { minimumCents: 0, discountBps: 1000 });
  assert.equal(p.discountCents, 1);
  assert.equal(p.pricePerUnitCents, 4);
});

test("quantities do not bypass the per-unit minimum", () => {
  const p = standard(40000, { discountBps: 1000, quantity: 6 });
  assert.equal(p.pricePerUnitCents, 45000);
  assert.equal(p.totalCents, 270000);
});

test("invalid quantity, rate, and fractional cents fail", () => {
  for (const input of [
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 1.25 },
    { baseCents: -100 },
    { baseCents: 100.5 },
    { discountBps: 10001 },
    { surchargeBps: -1 },
    { minimumCents: -1 },
  ]) assert.throws(() => standard(50000, input), RangeError);
  assert.throws(() => priceUnit({ currency: "EUR", baseCents: 50000, quantity: 1, minimumCents: 45000 }), /Unsupported currency/);
});

test("overflow is rejected instead of silently losing money precision", () => {
  assert.throws(() => standard(Number.MAX_SAFE_INTEGER, { surchargeBps: 4000 }), /range/);
  assert.throws(() => standard(50000, { quantity: Number.MAX_SAFE_INTEGER }), RangeError);
});
