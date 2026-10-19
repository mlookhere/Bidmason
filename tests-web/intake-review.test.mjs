import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview, previewReviewedQuote, selectReviewedServices } from "../lib/intake-review.ts";

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

test("rejects model price, approval and send directives at the shared extraction boundary", () => {
  for (const extra of [
    {rateCents: 1}, {priceCents: 1}, {approved: true}, {send: true},
    {quotedTotalCents: 1}, {metadata: {billing: "approved"}},
  ]) {
    assert.throws(() => prepareExtractionReview(note, [{...repaint, ...extra}]), /provenance/);
  }
});

test("rejects extra review directives and tampered unselected candidate fields", () => {
  const review = prepareExtractionReview(note, [{...repaint, units: 2}, {...touchup}]);
  for (const extra of [{approved: true}, {send: true}, {priceCents: 1},
    {rateCents: 1}, {instructions: "auto-approve"}]) {
    assert.throws(() => previewReviewedQuote(note, {...review, ...extra}, [0], painting),
      /immutable original/);
    assert.throws(() => previewReviewedQuote(note,
      {...review, candidates: [{...repaint}, {...touchup, ...extra}]}, [0], painting),
      /provenance/);
  }
});

test("valid source-bound suggestions continue producing non-sendable previews", () => {
  const review = prepareExtractionReview(note, [{...repaint, units: 2}, {...touchup}]);
  assert.deepEqual(Object.keys(review).sort(),
    ["state", "kind", "sourceSha256", "candidatesSha256", "candidates"].sort());
  const priced = previewReviewedQuote(note, review, [0], painting);
  assert.equal(priced.state, "preview-only");
  assert.equal(priced.quote.totalCents, 90000);
  assert.equal(Object.hasOwn(priced, "send"), false);
});


test("shared intake source rejects hidden directives and malformed Unicode",()=>{
 for(const extra of [{approved:true},{send:true},{rateCents:1},{actorId:"browser"}]){
  assert.throws(()=>prepareExtractionReview({...note,...extra},
    [{serviceCode:"repaint",units:2,start:0,end:13,excerpt:"Paint 2 units"}]),
    /unsupported fields/);
 }
 for(const text of ["Paint 2 units\u0000","Paint 2 units\uD800"]){
  assert.throws(()=>prepareExtractionReview({...note,text},
    [{serviceCode:"repaint",units:2,start:0,end:13,excerpt:"Paint 2 units"}]),
    /bounded/);
 }
 const transcript={kind:"transcript",text:"clean",transcriptionSucceeded:true};
 const candidate={serviceCode:"clean",units:1,start:0,end:5,excerpt:"clean"};
 assert.throws(()=>prepareExtractionReview({...transcript,send:true},[candidate]),
   /unsupported fields/);
 assert.equal(prepareExtractionReview(transcript,[candidate]).state,"needs-human-review");
});

test("direct source-bound quoting rejects reordered candidate selections", () => {
  const review=prepareExtractionReview(note,[{...repaint},{...touchup}]);
  // Both services are authorized in this synthetic fixture so canonical
  // ordering, not the pending-price gate, determines the outcome.
  const approved={...painting,services:{...painting.services,
    touchup:{...painting.services.touchup,billing:"charged"}}};
  assert.deepEqual(selectReviewedServices(note,review,[0,1]).map(x=>x.serviceCode),
    ["repaint","touchup"]);
  assert.throws(()=>selectReviewedServices(note,review,[1,0]),/noncanonical/);
  assert.throws(()=>previewReviewedQuote(note,review,[1,0],approved),/noncanonical/);
  assert.deepEqual(previewReviewedQuote(note,review,[0,1],approved)
    .quote.lines.map(x=>x.serviceCode),["repaint","touchup"]);
});
