import test from "node:test";
import assert from "node:assert/strict";
import { planEvidenceReconciliation } from "../lib/evidence-orphan-review.ts";

const org = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const path = org + "/50000000-0000-4000-8000-000000000001.pdf";
const more = org + "/50000000-0000-4000-8000-000000000002.png";
const foreign = other + "/50000000-0000-4000-8000-000000000003.jpg";
const now = new Date("2026-10-18T12:00:00.000Z");
const older = "2026-10-16T10:00:00.000Z";
const recent = "2026-10-18T11:30:00.000Z";
const object = (p, createdAt=older, updatedAt=createdAt) =>
  ({ bucketId: "bm-evidence", path: p, createdAt, updatedAt });
const snapshot = (changes={}) => ({
  objects: [object(path), object(more, older, recent), object(foreign)],
  receipts: [{ organizationId: org, path }],
  objectsComplete: true, receiptsComplete: true, now, ...changes,
});

test("only old receipt-less objects are sent to manual review, with no side effects", () => {
  const original = snapshot();
  const result = planEvidenceReconciliation(original);
  assert.deepEqual(result, {
    candidates: [{ organizationId: other, path: foreign, ageHours: 50 }],
    retained: 2, reviewed: 3,
  });
  assert.equal(original.objects.length, 3);
});

test("recent objects, receipt-backed objects and recent metadata updates are retained", () => {
  const result = planEvidenceReconciliation(snapshot({
    objects: [object(path), object(more, older, recent)],
  }));
  assert.equal(result.candidates.length, 0);
  assert.equal(result.retained, 2);
});

test("incomplete or untrusted snapshots fail closed rather than deleting or flagging", () => {
  for (const change of [
    { objectsComplete: false }, { receiptsComplete: false },
    { receipts: [{ organizationId: other, path }] },
    { receipts: [{ organizationId: org, path }, { organizationId: org, path }] },
    { objects: [object(path), object(path)] },
    { objects: [object("../unsafe")] },
    { objects: [{ ...object(path), bucketId: "public" }] },
    { objects: [object(path, "not-a-date")] },
    { objects: [object(path, recent, older)] },
    { objects: [object(path, older, "2026-10-19T00:00:00.000Z")] },
    { now: new Date("invalid") },
  ]) assert.throws(() => planEvidenceReconciliation(snapshot(change)));
});

test("one missing receipt does not automatically mean an upload is abandoned", () => {
  const result = planEvidenceReconciliation(snapshot({
    objects: [object(path, recent)], receipts: [],
  }));
  assert.deepEqual(result.candidates, []);
  assert.equal(result.retained, 1);
});

test("receipts from other tenants cannot mask or relabel an object path", () => {
  assert.throws(() => planEvidenceReconciliation(snapshot({
    receipts: [{ organizationId: other, path }],
  })), /cross-tenant/);
});

test("exact 24-hour boundary is eligible for review only, never removal", () => {
  const result = planEvidenceReconciliation(snapshot({
    objects: [object(path, "2026-10-17T12:00:00.000Z")],
    receipts: [],
  }));
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].ageHours, 24);
});
