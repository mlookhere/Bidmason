import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview } from "../lib/intake-review.ts";
import { parseUntrustedExtraction } from "../lib/intake-extraction-adapter.ts";
import { previewReviewedEconomics } from "../lib/intake-quote-preview.ts";

const original = { kind: "typed-note", text: "Repaint 2 units. Quarterly service pending." };
const repaint = { serviceCode: "repaint", units: 2, start: 0, end: 15,
  excerpt: "Repaint 2 units" };
const quarterly = { serviceCode: "quarterly", units: 1, start: 17, end: 42,
  excerpt: "Quarterly service pending" };
const policy = {
  revision: 2,
  pricing: {
    policyId: "synthetic-painting",
    currency: "USD",
    minimum: { rule: "per-line", cents: 45000 },
    calculationOrder: "surcharge-then-discount",
    services: {
      repaint: { label: "Repaint", unit: "unit", rateCents: 40000, billing: "charged" },
      quarterly: { label: "Quarterly", unit: "visit", rateCents: 47500, billing: "pending" },
    },
  },
  excludedServiceCodes: ["quarterly"],
  tax: { method: "exclusive-all-charged", bps: 800 },
  unitDirectCostsCents: { repaint: 24000 },
};

test("exact source and human selection produce only a versioned economics preview", () => {
  const review = parseUntrustedExtraction(original,
    JSON.stringify({candidates:[repaint, quarterly]}));
  const preview = previewReviewedEconomics(original, review, [0], policy);
  assert.equal(preview.state,"preview-only");
  assert.equal(preview.economics.state,"preview-only");
  assert.equal(preview.economics.policyRevision,2);
  assert.equal(preview.economics.quote.totalCents,90000);
  assert.equal(preview.economics.taxCents,7200);
  assert.equal(preview.economics.totalWithTaxCents,97200);
  assert.equal(preview.economics.estimatedDirectCostsCents,48000);
  assert.deepEqual(preview.selectedServices, [{
    serviceCode:"repaint", units:2,start:0,end:15,
  }]);
  assert.match(preview.reviewedSelectionSha256,/^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(preview,"approved"),false);
});

test("policy revision and selected units alter preview fingerprints", () => {
  const review = prepareExtractionReview(original,[repaint]);
  const a = previewReviewedEconomics(original,review,[0],policy);
  const b = previewReviewedEconomics(original,review,[0],{...policy,revision:3});
  assert.notEqual(a.reviewedSelectionSha256,b.reviewedSelectionSha256);
  const changed = prepareExtractionReview(original,[{...repaint,units:3}]);
  const c = previewReviewedEconomics(original,changed,[0],policy);
  assert.notEqual(a.reviewedSelectionSha256,c.reviewedSelectionSha256);
  assert.equal(c.economics.quote.totalCents,135000);
});

test("unsupported, pending and excluded services never yield a quote", () => {
  const review=prepareExtractionReview(original,[repaint,quarterly]);
  assert.throws(()=>previewReviewedEconomics(original,review,[1],policy),/excluded/);
  assert.throws(()=>previewReviewedEconomics(original,review,[0,1],
    {...policy,excludedServiceCodes:[]}),/Unapproved service terms/);
  assert.throws(()=>previewReviewedEconomics(original,review,[0],
    {...policy,excludedServiceCodes:[],pricing:{...policy.pricing,services:{}}}),/Unknown/);
});

test("stale, tampered, absent and duplicated human selections fail closed", () => {
  const review=prepareExtractionReview(original,[repaint]);
  assert.throws(()=>previewReviewedEconomics({...original,text:original.text+"."},
    review,[0],policy),/immutable original/);
  const tampered={...review,candidates:[{...repaint,units:7}]};
  assert.throws(()=>previewReviewedEconomics(original,tampered,[0],policy),
    /snapshot was modified/);
  assert.throws(()=>previewReviewedEconomics(original,review,[],policy),/Explicit reviewed/);
  assert.throws(()=>previewReviewedEconomics(original,review,[0,0],policy),
    /duplicated|Explicit reviewed/);
});

test("failed transcript is rejected even with correct extraction offsets", () => {
  const transcript={kind:"transcript",text:"Repaint 2 units. Quarterly service pending.",
    transcriptionSucceeded:false};
  assert.throws(()=>prepareExtractionReview(transcript,[repaint]),/transcription/);
});

test("optional service needs human add-on acknowledgement separate from extraction",()=>{
  const review=prepareExtractionReview(original,[repaint,quarterly]);
  const config={...policy,excludedServiceCodes:[],
    pricing:{...policy.pricing,services:{...policy.pricing.services,
      repaint:{...policy.pricing.services.repaint,optionalAddon:true}}},
  };
  assert.throws(()=>previewReviewedEconomics(original,review,[0],config),
    /requires explicit human acceptance/);
  const accepted=previewReviewedEconomics(original,review,[0],config,["repaint"]);
  assert.equal(accepted.economics.quote.totalCents,90000);
  assert.equal(accepted.selectedServices[0].addonAccepted,true);
  assert.throws(()=>previewReviewedEconomics(original,review,[0],config,["quarterly"]),
    /Invalid or unselected/);
  assert.throws(()=>previewReviewedEconomics(original,review,[0],config,
    ["repaint","repaint"]),/Invalid or unselected/);
  assert.notEqual(accepted.reviewedSelectionSha256,
    previewReviewedEconomics(original,review,[0],
      {...config,pricing:{...config.pricing,services:{
        ...config.pricing.services,repaint:{...config.pricing.services.repaint,
          optionalAddon:false}}}}).reviewedSelectionSha256);
});

test("direct economics preview rejects reordered selection without changing pricing policy", () => {
  const review=prepareExtractionReview(original,[repaint,quarterly]);
  const approved={...policy,excludedServiceCodes:[],
    unitDirectCostsCents:{...policy.unitDirectCostsCents,quarterly:10000},
    pricing:{...policy.pricing,services:{...policy.pricing.services,
      quarterly:{...policy.pricing.services.quarterly,billing:"charged"}}}};
  const valid=previewReviewedEconomics(original,review,[0,1],approved);
  assert.deepEqual(valid.selectedServices.map(x=>x.serviceCode),
    ["repaint","quarterly"]);
  assert.throws(()=>previewReviewedEconomics(original,review,[1,0],approved),
    /noncanonical/);
  assert.throws(()=>previewReviewedEconomics(original,review,[0,0],approved),
    /duplicated/);
});
