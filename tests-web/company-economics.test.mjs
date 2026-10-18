import test from "node:test";
import assert from "node:assert/strict";
import { previewCompanyEconomics } from "../lib/company-economics.ts";

const paint = {
  revision: 3,
  pricing: {
    policyId: "synthetic-painting",
    currency: "USD",
    minimum: {rule: "per-line", cents: 45000},
    calculationOrder: "surcharge-then-discount",
    services: {
      repaint: {label:"Repaint",unit:"unit",rateCents:40000,billing:"charged"},
      quarterly: {label:"Quarterly",unit:"visit",rateCents:47500,billing:"pending"},
    },
  },
  tax: {method: "none",bps:0},
  excludedServiceCodes: ["quarterly"],
  unitDirectCostsCents: {repaint:20000},
};
const clean = {
  revision: 1,
  pricing: {
    policyId:"synthetic-cleaning",
    currency:"USD",
    minimum:{rule:"quote",cents:12000},
    calculationOrder:"discount-then-surcharge",
    services: {
      office:{label:"Office clean",unit:"visit",rateCents:7000,billing:"charged"},
      supplies:{label:"Supplies",unit:"visit",rateCents:0,billing:"included"},
    },
  },
  tax: {method:"exclusive-all-charged",bps:725},
  unitDirectCostsCents:{office:4000,supplies:1000},
};

test("painting minimum stays company-specific; no tax or inferred quarterly terms",()=>{
  const out=previewCompanyEconomics(paint,[{serviceCode:"repaint",units:2}]);
  assert.equal(out.state,"preview-only");
  assert.equal(out.policyRevision,3);
  assert.match(out.policySha256,/^[0-9a-f]{64}$/);
  assert.equal(out.quote.totalCents,90000);
  assert.equal(out.taxCents,0);
  assert.equal(out.totalWithTaxCents,90000);
  assert.equal(out.estimatedDirectCostsCents,40000);
  assert.equal(out.estimatedGrossMarginBps,5556);
  assert.throws(()=>previewCompanyEconomics(paint,[{serviceCode:"quarterly",units:1}]),/excluded/);
});

test("quote-level minimum is applied before company-configured whole-quote tax",()=>{
  const result=previewCompanyEconomics(clean,[{serviceCode:"office",units:1},
    {serviceCode:"supplies",units:1}]);
  assert.equal(result.quote.minimumAdjustmentCents,5000);
  assert.equal(result.quote.totalCents,12000);
  assert.equal(result.taxCents,870);
  assert.equal(result.totalWithTaxCents,12870);
  assert.equal(result.estimatedDirectCostsCents,5000);
  assert.equal(result.estimatedGrossMarginBps,5833);
});

test("different policy revisions produce different deterministic fingerprints",()=>{
  const a=previewCompanyEconomics(clean,[{serviceCode:"office",units:1}]);
  const b=previewCompanyEconomics({...clean,revision:2},[{serviceCode:"office",units:1}]);
  assert.notEqual(a.policySha256,b.policySha256);
  assert.equal(a.totalWithTaxCents,b.totalWithTaxCents);
});

test("rejects absent, unapproved or contradictory tax settings instead of assuming defaults",()=>{
  for (const config of [
    {...clean,revision:0},
    {...clean,tax:{method:"none",bps:100}},
    {...clean,tax:{method:"exclusive-all-charged",bps:-1}},
    {...clean,tax:{method:"exclusive-all-charged",bps:10001}},
  ]) assert.throws(()=>previewCompanyEconomics(config,[{serviceCode:"office",units:1}]));
});

test("invalid exclusions and corrupt or incomplete cost schedules fail closed",()=>{
  assert.throws(()=>previewCompanyEconomics({...clean,excludedServiceCodes:["other"]},
    [{serviceCode:"office",units:1}]),/exclusions/);
  assert.throws(()=>previewCompanyEconomics({...clean,excludedServiceCodes:["office","office"]},
    [{serviceCode:"office",units:1}]),/exclusions/);
  assert.throws(()=>previewCompanyEconomics({...clean,unitDirectCostsCents:{}},
    [{serviceCode:"office",units:1}]),/Missing direct cost/);
  assert.throws(()=>previewCompanyEconomics({...clean,unitDirectCostsCents:{office:-10}},
    [{serviceCode:"office",units:1}]),/unit direct cost/);
});

test("tax and costs remain safe for zero-charge included services and arithmetic overflow",()=>{
  const free={...clean,pricing:{...clean.pricing,minimum:{rule:"none",cents:0}}};
  const result=previewCompanyEconomics(free,[{serviceCode:"supplies",units:1}]);
  assert.equal(result.taxCents,0);
  assert.equal(result.estimatedGrossMarginBps,null);
  assert.throws(()=>previewCompanyEconomics({
    ...clean,pricing:{...clean.pricing,services:{big:{
      label:"Big",unit:"unit",rateCents:Number.MAX_SAFE_INTEGER,billing:"charged",
    }}},unitDirectCostsCents:{big:0}
  },[{serviceCode:"big",units:1}]), /Tax exceeds|safe/);
});
