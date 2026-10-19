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

test("optional add-ons need explicit opt-in; ordinary services reject fabricated add-on flags", () => {
  const policy = { ...cleaning, minimum: { rule:"none", cents:0 },
    services: { ...cleaning.services,
      carpet: { label:"Carpet treatment",unit:"room",rateCents:2500,
        billing:"charged",optionalAddon:true },
    },
  };
  assert.throws(()=>quoteFromPolicy(policy,[{serviceCode:"carpet",units:1}]),
    /requires explicit human acceptance/);
  assert.equal(quoteFromPolicy(policy,[{serviceCode:"carpet",units:2,
    addonAccepted:true}]).totalCents,5000);
  assert.throws(()=>quoteFromPolicy(policy,[{serviceCode:"visit",units:1,
    addonAccepted:true}]),/non-optional/);
  assert.throws(()=>quoteFromPolicy({...policy,services:{...policy.services,
    carpet:{...policy.services.carpet,optionalAddon:"yes"}}},
    [{serviceCode:"carpet",units:1,addonAccepted:true}]),/Invalid optional/);
});

test("valid high-cent percentage arithmetic does not falsely overflow intermediates", () => {
  const policy={...cleaning,minimum:{rule:"none",cents:0},services:{
    big:{label:"Large valid fixed-price contract",unit:"job",
      rateCents:1000000000000,billing:"charged",surchargeBps:5000},
  }};
  assert.equal(quoteFromPolicy(policy,[{serviceCode:"big",units:1}]).totalCents,
    1500000000000);
});

test("direct quote inputs reject hidden prices and approval directives", () => {
  const normal=[{serviceCode:"visit",units:2}];
  const expected=quoteFromPolicy(cleaning,normal);
  assert.equal(expected.totalCents,14000);
  for (const forged of [
    {rateCents:1}, {unitPriceCents:1}, {totalCents:1}, {priceCents:1},
    {discountBps:10000}, {approved:true}, {send:true},
    {recipient:"attacker@example.invalid"}, {organizationId:"forged"},
    {addonAccepted:false}, {addonAccepted:true,approved:true},
  ]) {
    assert.throws(()=>quoteFromPolicy(cleaning,[
      {...normal[0],...forged},
    ]), /unsupported fields|non-optional/);
  }
  for (const bad of [null,[],{},Object.create({serviceCode:"visit",units:1})]) {
    assert.throws(()=>quoteFromPolicy(cleaning,[bad]),/unsupported fields/);
  }
  assert.equal(quoteFromPolicy(cleaning,normal).totalCents,expected.totalCents);
});

test("direct quote calculator bounds request cardinality to reviewed intake limits", () => {
  const many=Array.from({length:51},(_,i)=>({
    serviceCode:`line_${i}`,units:1,
  }));
  const policy={...cleaning,services:Object.fromEntries(many.map(line=>[
    line.serviceCode,
    {label:"Line",unit:"job",rateCents:100,billing:"charged"},
  ]))};
  assert.throws(()=>quoteFromPolicy(policy,many),/One to 50 services/);
  assert.equal(quoteFromPolicy(policy,many.slice(0,50)).lines.length,50);
});

test("direct quote accepts only canonical own enumerable data fields", () => {
  const normal = { serviceCode:"visit", units:1 };
  const inherited = Object.assign(Object.create({ approved:true }), normal);
  const hidden = { ...normal };
  Object.defineProperty(hidden, "send", { value:true });
  const accessor = { ...normal };
  Object.defineProperty(accessor, "units", { enumerable:true,
    get() { return 1; } });
  const symbol = { ...normal, [Symbol("recipient")]: "forged" };
  for (const untrusted of [inherited, hidden, accessor, symbol,
    { ...normal, addonAccepted:undefined }]) {
    assert.throws(() => quoteFromPolicy(cleaning, [untrusted]),
      /unsupported fields|non-optional/);
  }
  const plain = Object.assign(Object.create(null), normal);
  assert.equal(quoteFromPolicy(cleaning, [plain]).totalCents, 12000);
});


test("untrusted line collections cannot execute array or item getters",()=>{
 let getterCalls=0;
 const baseline=()=>[{serviceCode:"visit",units:2}];
 const corrupt=[
  rows=>Object.defineProperty(rows,"0",{enumerable:true,configurable:true,
    get(){getterCalls++;throw Error("malicious quote row getter");}}),
  rows=>{delete rows[0];},
  rows=>Object.defineProperty(rows,"0",{enumerable:false,
    value:rows[0],configurable:true}),
  rows=>{rows[Symbol("approved")]=true;},
  rows=>Object.defineProperty(rows,"send",{value:true}),
  rows=>Object.setPrototypeOf(rows,Object.create(Array.prototype)),
  rows=>Object.defineProperty(rows[0],"serviceCode",{enumerable:true,
    get(){getterCalls++;throw Error("malicious serviceCode getter");}}),
  rows=>Object.defineProperty(rows[0],"units",{enumerable:true,
    get(){getterCalls++;throw Error("malicious units getter");}}),
 ];
 for(const alter of corrupt){
  const rows=baseline();alter(rows);
  assert.throws(()=>quoteFromPolicy(cleaning,rows),
    /One to 50 services|Quote line contains unsupported fields/);
 }
 assert.equal(getterCalls,0);
 const nullProto=Object.assign(Object.create(null),baseline()[0]);
 assert.equal(quoteFromPolicy(cleaning,[nullProto]).totalCents,14000);
});
