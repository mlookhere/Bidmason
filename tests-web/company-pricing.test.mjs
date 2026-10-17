import test from "node:test";
import assert from "node:assert/strict";
import { quoteFromPolicy } from "../lib/company-pricing.ts";

const painting = {
  policyId: "painting-fixture-v1",
  currency: "USD",
  minimum: { rule: "per-line", cents: 45000 },
  calculationOrder: "surcharge-then-discount",
  services: {
    unit_turn: { label: "Unit repaint", unit: "unit", rateCents: 40000, billing: "charged", discountBps: 1000 },
    touchup: { label: "Quarterly common-area visit", unit: "visit", rateCents: 47500, billing: "pending" },
  },
};
const cleaning = {
  policyId: "cleaning-fixture-v1",
  currency: "USD",
  minimum: { rule: "quote", cents: 12000 },
  calculationOrder: "discount-then-surcharge",
  services: {
    visit: { label: "Office cleaning", unit: "visit", rateCents: 7000, billing: "charged" },
    restrooms: { label: "Restroom cleaning", unit: "room", rateCents: 2000, billing: "charged", surchargeBps: 2500 },
    supplies: { label: "Supplies", unit: "visit", rateCents: 5000, billing: "included" },
  },
};

test("pricing comes from the company's configuration, never from a fixed example rate", () => {
  const a = quoteFromPolicy(painting, [{ serviceCode: "unit_turn", units: 2 }]);
  const b = quoteFromPolicy(cleaning, [{ serviceCode: "visit", units: 2 }]);
  assert.equal(a.totalCents, 90000);
  assert.equal(b.totalCents, 14000);
  assert.equal(a.policyId, "painting-fixture-v1");
  assert.equal(b.policyId, "cleaning-fixture-v1");
  assert.equal(a.lines[0].unitPriceCents, 45000);
});

test("quote-level minimum differs from per-line minimum, and included work is not billed", () => {
  const quote = quoteFromPolicy(cleaning, [
    { serviceCode: "visit", units: 1 },
    { serviceCode: "supplies", units: 1 },
  ]);
  assert.equal(quote.subtotalCents, 7000);
  assert.equal(quote.minimumAdjustmentCents, 5000);
  assert.equal(quote.totalCents, 12000);
  assert.equal(quote.lines[1].totalCents, 0);
});

test("different companies can choose a different surcharge/discount order", () => {
  const base = { label: "Service", unit: "hour", rateCents: 10000, billing: "charged", discountBps: 1000, surchargeBps: 2500 };
  const policy = { ...cleaning, minimum: { rule: "none", cents: 0 }, services: { job: base } };
  assert.equal(quoteFromPolicy(policy, [{ serviceCode: "job", units: 1 }]).totalCents, 11250);
  assert.equal(quoteFromPolicy({ ...policy, calculationOrder: "surcharge-then-discount" },
    [{ serviceCode: "job", units: 1 }]).totalCents, 11250);
  const withRounding = { ...base, rateCents: 7, discountBps: 1000, surchargeBps: 5000 };
  const other = { ...policy, services: { job: withRounding } };
  assert.equal(quoteFromPolicy(other, [{ serviceCode: "job", units: 1 }]).totalCents, 9);
  assert.equal(quoteFromPolicy({ ...other, calculationOrder: "surcharge-then-discount" },
    [{ serviceCode: "job", units: 1 }]).totalCents, 10);
});

test("unapproved painting touch-up remains absent from quotable terms without a forced yes/no decision", () => {
  assert.throws(() => quoteFromPolicy(painting, [{ serviceCode: "touchup", units: 1 }]),
    /Unapproved service terms/);
  const approvedExcluded = {
    ...painting, services: { ...painting.services,
      touchup: { ...painting.services.touchup, billing: "included" } },
  };
  const approvedCharged = {
    ...painting, services: { ...painting.services,
      touchup: { ...painting.services.touchup, billing: "charged" } },
  };
  assert.equal(quoteFromPolicy(approvedExcluded, [{ serviceCode: "touchup", units: 1 }]).totalCents, 0);
  assert.equal(quoteFromPolicy(approvedCharged, [{ serviceCode: "touchup", units: 1 }]).totalCents, 47500);
  // These are contrasting synthetic configurations, not real approvals.
});

test("unknown, duplicate and corrupt service terms fail closed", () => {
  assert.throws(() => quoteFromPolicy(painting, [{ serviceCode: "unlisted", units: 1 }]), /Unknown/);
  assert.throws(() => quoteFromPolicy(painting, [
    { serviceCode: "unit_turn", units: 1 }, { serviceCode: "unit_turn", units: 1 },
  ]), /duplicated/);
  assert.throws(() => quoteFromPolicy(painting, [{ serviceCode: "unit_turn", units: 0 }]), /units/);
  assert.throws(() => quoteFromPolicy({ ...painting, minimum: { rule: "none", cents: 45000 } },
    [{ serviceCode: "unit_turn", units: 1 }]), /disabled minimum/);
  assert.throws(() => quoteFromPolicy({ ...painting, services: { unit_turn: { ...painting.services.unit_turn, billing: "unknown" } } },
    [{ serviceCode: "unit_turn", units: 1 }]), /Invalid billing policy/);
});

test("arithmetic overflow never returns an apparently valid quotation", () => {
  assert.throws(() => quoteFromPolicy({ ...cleaning, services: {
    huge: { label: "Huge", unit: "unit", rateCents: Number.MAX_SAFE_INTEGER, billing: "charged", surchargeBps: 1000 },
  } }, [{ serviceCode: "huge", units: 10 }]), RangeError);
});
