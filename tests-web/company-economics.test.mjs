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

test("company add-on charges enter tax and direct-cost preview only after explicit opt-in",()=>{
  const policy={...clean,pricing:{...clean.pricing,services:{...clean.pricing.services,
    window:{label:"Window treatment",unit:"window",rateCents:3000,
      billing:"charged",optionalAddon:true}}},
    unitDirectCostsCents:{...clean.unitDirectCostsCents,window:1200},
  };
  assert.throws(()=>previewCompanyEconomics(policy,
    [{serviceCode:"office",units:2},{serviceCode:"window",units:1}]),/requires explicit/);
  const preview=previewCompanyEconomics(policy,
    [{serviceCode:"office",units:2},{serviceCode:"window",units:1,addonAccepted:true}]);
  assert.equal(preview.quote.totalCents,17000);
  assert.equal(preview.taxCents,1233);
  assert.equal(preview.totalWithTaxCents,18233);
  assert.equal(preview.estimatedDirectCostsCents,9200);
});

test("internal economics preview rejects caller-provided quote authority and amounts",()=>{
 const input={serviceCode:"office",units:1};
 const base=previewCompanyEconomics(clean,[input]);
 assert.equal(base.state,"preview-only");
 for(const directive of [
  {priceCents:1},{rateCents:1},{taxCents:0},{quoteTotalCents:0},
  {approved:true},{send:true},{recipient:"example@invalid.test"},
  {policyRevision:999},
 ]) {
  assert.throws(()=>previewCompanyEconomics(clean,[{...input,...directive}]),
    /unsupported fields/);
 }
 assert.equal(previewCompanyEconomics(clean,[input]).totalWithTaxCents,
   base.totalWithTaxCents);
});

test("policy preview uses one canonical revision for prices, costs and SHA",()=>{
 const policy=structuredClone(clean);
 const original=previewCompanyEconomics(policy,[{serviceCode:"office",units:2}]);
 assert.equal(original.policyRevision,1);
 assert.equal(original.economics,undefined);
 assert.equal(original.quote.totalCents,14000);
 assert.equal(original.estimatedDirectCostsCents,8000);
 policy.pricing.services.office.rateCents=8000;
 policy.unitDirectCostsCents.office=5000;
 const changed=previewCompanyEconomics(policy,[{serviceCode:"office",units:2}]);
 assert.equal(changed.quote.totalCents,16000);
 assert.equal(changed.estimatedDirectCostsCents,10000);
 assert.notEqual(original.policySha256,changed.policySha256);
 assert.equal(original.quote.totalCents,14000);
});

test("untrusted policy getters never run before quote and hash evaluation",()=>{
 let reads=0;
 for(const variant of ["rate","tax","directCosts"]){
  const input=structuredClone(clean);
  if(variant==="rate"){
   Object.defineProperty(input.pricing.services.office,"rateCents",{
    enumerable:true,get(){reads++;return 1;},
   });
  }else if(variant==="tax"){
   Object.defineProperty(input.tax,"bps",{
    enumerable:true,get(){reads++;return 10000;},
   });
  }else{
   Object.defineProperty(input.unitDirectCostsCents,"office",{
    enumerable:true,get(){reads++;return 1;},
   });
  }
  assert.throws(()=>previewCompanyEconomics(input,[{serviceCode:"office",units:1}]),
   /own enumerable data/);
 }
 assert.equal(reads,0);
});

test("economic preview refuses hidden rate directives and custom serializers",()=>{
 const baseline=previewCompanyEconomics(clean,[{serviceCode:"office",units:1}]);
 const hidden=structuredClone(clean);
 Object.defineProperty(hidden.pricing.services.office,"priceOverrideCents",{
  value:1,enumerable:false,
 });
 assert.throws(()=>previewCompanyEconomics(hidden,[{serviceCode:"office",units:1}]),
  /Policy must contain only own enumerable data fields/);
 let toJSONCalls=0;
 const forged=structuredClone(clean);
 Object.defineProperty(forged.pricing.services.office,"toJSON",{
  value(){toJSONCalls++;return {label:"Office",unit:"visit",rateCents:1,billing:"charged"};},
 });
 assert.throws(()=>previewCompanyEconomics(forged,[{serviceCode:"office",units:1}]),
  /Policy must contain only own enumerable data fields/);
 assert.equal(toJSONCalls,0);
 assert.equal(previewCompanyEconomics(clean,[{serviceCode:"office",units:1}]).policySha256,
  baseline.policySha256);
});


test("economics exclusion preflight cannot evaluate malicious getters",()=>{
 let getterCalls=0;
 const valid=()=>[{serviceCode:"office",units:1}];
 const corrupt=[
  rows=>Object.defineProperty(rows,"0",{enumerable:true,configurable:true,
    get(){getterCalls++;throw Error("unsafe array index getter");}}),
  rows=>{delete rows[0];},
  rows=>{rows[Symbol("send")]=true;},
  rows=>Object.setPrototypeOf(rows,Object.create(Array.prototype)),
  rows=>Object.defineProperty(rows[0],"serviceCode",{enumerable:true,
    get(){getterCalls++;throw Error("unsafe excluded service getter");}}),
  rows=>Object.defineProperty(rows[0],"units",{enumerable:true,
    get(){getterCalls++;throw Error("unsafe units getter");}}),
  rows=>Object.defineProperty(rows[0],"send",{value:true}),
 ];
 for(const alter of corrupt){
  const rows=valid();alter(rows);
  assert.throws(()=>previewCompanyEconomics(clean,rows),
    /One to 50 canonical services|Quote line contains unsupported fields/);
 }
 assert.equal(getterCalls,0);
 assert.equal(previewCompanyEconomics(clean,[valid()[0]]).state,"preview-only");
 // An excluded line still reports the intended denial after input validation.
 assert.throws(()=>previewCompanyEconomics(paint,[
  {serviceCode:"quarterly",units:1}]),/Company-excluded service/);
});
