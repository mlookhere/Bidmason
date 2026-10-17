import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priceUnit, validateQuarterlyTouchUp } from "../lib/pricing.ts";

const snapshot = JSON.parse(readFileSync(new URL("../fixtures/demo_snapshot.json", import.meta.url), "utf8"));
const bases = { studioCents: 40000, oneBedCents: 50000, twoBedCents: 60000 };

test("PDF demo fixture derives each displayed amount from one canonical pricing function", () => {
  assert.equal(snapshot.kind, "synthetic-demo-not-for-delivery");
  for (const tier of snapshot.programs) {
    for (const [field, baseCents] of Object.entries(bases)) {
      const expected = priceUnit({
        currency: "USD", baseCents, quantity: 1,
        minimumCents: snapshot.minimumCents, discountBps: tier.discountBps,
      }).pricePerUnitCents;
      assert.equal(tier[field], expected, tier.name + ":" + field);
    }
  }
});

test("PDF fixture refuses to assume unapproved quarterly pricing", () => {
  assert.equal(snapshot.quarterly.fixtureAssumptionOnly, true);
  assert.equal(snapshot.quarterly.status, "pending-owner-approval");
  assert.equal(snapshot.quarterly.included, null);
  assert.equal(snapshot.quarterly.additionalCents, null);
  assert.equal(snapshot.quarterly.standaloneReferenceCents, 47500);
  assert.throws(() => validateQuarterlyTouchUp(true, 47500), /both included/);
});
