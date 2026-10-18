import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview, previewReviewedQuote } from "../lib/intake-review.ts";

const painting = {
  policyId: "painting-v1", currency: "USD",
  minimum: { rule: "per-line", cents: 45000 },
  calculationOrder: "surcharge-then-discount",
  services: {
    repaint: { label: "Repaint", unit: "unit", rateCents: 40000, billing: "charged" },
    touchup: { label: "Quarterly visit", unit: "visit", rateCents: 47500, billing: "pending" },
  },
};
const cleaning = {
  policyId: "cleaning-v2", currency: "USD",
  minimum: { rule: "quote", cents: 12000 },
  calculationOrder: "discount-then-surcharge",
  services: {
    clean: { label: "Office clean", unit: "visit", rateCents: 7000, billing: "charged" },
  },
};
const note = { kind: "typed-note", text: "Paint 2 units; quarterly visit pending." };
const repaint = { serviceCode: "repaint", units: 2, start: 0, end: 13,
  excerpt: "Paint 2 units" };
const touchup = { serviceCode: "touchup", units: 1, start: 15, end: 30,
  excerpt: "quarterly visit" };

test("typed extraction stays unapproved until a human selects provenance-bound lines", () => {
  const review = prepareExtractionReview(note, [repaint, touchup]);
  assert.equal(review.state, "needs-human-review");
  assert.match(review.sourceSha256, /^[0-9a-f]{64}$/);
  const preview = previewReviewedQuote(note, review, [0], painting);
  assert.equal(preview.state, "preview-only");
  assert.equal(preview.quote.totalCents, 90000);
  assert.equal(preview.quote.policyId, "painting-v1");
  assert.deepEqual(preview.quote.lines.map(x => x.serviceCode), ["repaint"]);
});

test("unapproved commercial terms are never priced even if extractor suggests them", () => {
  const review = prepareExtractionReview(note, [repaint, touchup]);
  assert.throws(() => previewReviewedQuote(note, review, [1], painting), /Unapproved service terms/);
  assert.throws(() => previewReviewedQuote(note, review, [], painting), /Explicit reviewed/);
  assert.throws(() => previewReviewedQuote(note, review, [0, 0], painting), /duplicated/);
});

test("changed original, forged excerpt and tampered selection fail closed", () => {
  const review = prepareExtractionReview(note, [repaint]);
  assert.throws(() => previewReviewedQuote({ ...note, text: note.text + "!" }, review, [0], painting), /immutable original/);
  assert.throws(() => prepareExtractionReview(note, [{ ...repaint, excerpt: "Charge 5 units" }]), /provenance/);
  assert.throws(() => previewReviewedQuote(note, { ...review,
    candidates: [{ ...repaint, units: 0 }] }, [0], painting), /provenance/);
  assert.throws(() => previewReviewedQuote(note, review, [1], painting), /selection/);
});

test("failed transcript, empty text, excessive size and unsafe quantities fail closed", () => {
  assert.throws(() => prepareExtractionReview({ kind: "transcript", text: "clean" },
    [{ serviceCode: "clean", units: 1, start: 0, end: 5, excerpt: "clean" }]), /transcription/);
  assert.throws(() => prepareExtractionReview({ kind: "typed-note", text: "" }, [repaint]), /bounded/);
  assert.throws(() => prepareExtractionReview({ ...note, text: "x".repeat(65537) }, [repaint]), /bounded/);
  assert.throws(() => prepareExtractionReview(note,
    [{ ...repaint, units: Number.MAX_SAFE_INTEGER + 1 }]), /provenance/);
});

test("successful transcript is still only a draft; cleaning prices use its own policy", () => {
  const input = { kind: "transcript", text: "1 office clean", transcriptionSucceeded: true };
  const candidate = { serviceCode: "clean", units: 1, start: 2, end: 14, excerpt: "office clean" };
  const review = prepareExtractionReview(input, [candidate]);
  const result = previewReviewedQuote(input, review, [0], cleaning);
  assert.equal(result.quote.totalCents, 12000);
  assert.equal(result.quote.policyId, "cleaning-v2");
  assert.equal(result.state, "preview-only");
  assert.throws(() => previewReviewedQuote(input, review, [0], painting), /Unknown/);
});

test("different candidates cannot be silently duplicated or individually approved by extraction", () => {
  const review = prepareExtractionReview(note, [repaint]);
  assert.notEqual(review.candidates[0], repaint);
  repaint.units = 9;
  assert.equal(review.candidates[0].units, 2);
  assert.throws(() => previewReviewedQuote(note, review, [0, 0], painting), /selection|duplicated/);
});


test("editing selected units or service IDs after extraction invalidates the review snapshot", () => {
  const review = prepareExtractionReview(note, [{...repaint}]);
  assert.match(review.candidatesSha256, /^[0-9a-f]{64}$/);
  review.candidates[0].units = 5;
  assert.throws(() => previewReviewedQuote(note, review, [0], painting), /snapshot was modified/);
  const second = prepareExtractionReview(note, [{...repaint}]);
  second.candidates[0].serviceCode = "touchup";
  assert.throws(() => previewReviewedQuote(note, second, [0], painting), /snapshot was modified/);
});
