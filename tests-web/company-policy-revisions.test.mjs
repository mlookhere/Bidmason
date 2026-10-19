import test from "node:test";
import assert from "node:assert/strict";
import { submitPolicyDraft, reviewPolicyDraft, readActivePolicy
} from "../lib/company-policy-revisions.ts";
import { previewCompanyEconomics } from "../lib/company-economics.ts";

const orgA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const creator="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reviewer="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const policy=(revision=1)=>({
  revision,
  pricing:{ policyId:"cleaning-v"+revision,currency:"USD",
    minimum:{rule:"quote",cents:12000},
    calculationOrder:"discount-then-surcharge",
    services:{
      office:{label:"Office clean",unit:"visit",rateCents:7000,billing:"charged"},
      quarterly:{label:"Unapproved quarterly",unit:"visit",rateCents:47500,billing:"pending"},
    },
  },
  tax:{method:"none",bps:0},
  excludedServiceCodes:["quarterly"],
  unitDirectCostsCents:{office:4000},
});
const begin=(org=orgA)=>submitPolicyDraft(null,{
  organizationId:org,submittedBy:creator,policy:policy(),
  expectedRevision:0,expectedSha256:null,
});
const accept=(draft,decision="approve")=>reviewPolicyDraft(draft,{
  organizationId:draft.organizationId,reviewedBy:reviewer,
  decision,expectedRevision:draft.revisions.at(-1).revision,
  expectedSha256:draft.revisions.at(-1).policySha256,
});

test("draft requires independent approval and is not an active price list",()=>{
  const draft=begin();
  assert.equal(draft.activeRevision,null);
  assert.equal(draft.revisions[0].status,"draft");
  assert.throws(()=>readActivePolicy(draft,orgA),/No approved/);
  assert.throws(()=>reviewPolicyDraft(draft,{
    organizationId:orgA,reviewedBy:creator,decision:"approve",
    expectedRevision:1,expectedSha256:draft.revisions[0].policySha256,
  }),/Self approval/);
  const approved=accept(draft);
  assert.equal(draft.revisions[0].status,"draft");
  assert.equal(approved.activeRevision,1);
  assert.equal(approved.revisions[0].reviewedBy,reviewer);
  const preview=previewCompanyEconomics(readActivePolicy(approved,orgA),
    [{serviceCode:"office",units:1}]);
  assert.equal(preview.state,"preview-only");
  assert.equal(preview.quote.totalCents,12000);
  assert.throws(()=>previewCompanyEconomics(readActivePolicy(approved,orgA),
    [{serviceCode:"quarterly",units:1}]),/excluded/);
});

test("rejected new draft preserves prior approved company policy",()=>{
  const approved=accept(begin());
  const draft=submitPolicyDraft(approved,{organizationId:orgA,submittedBy:creator,
    policy:policy(2),expectedRevision:1,expectedSha256:approved.revisions[0].policySha256});
  assert.equal(draft.activeRevision,1);
  assert.equal(draft.revisions[1].status,"draft");
  assert.equal(readActivePolicy(draft,orgA).revision,1);
  const rejected=accept(draft,"reject");
  assert.equal(rejected.activeRevision,1);
  assert.equal(rejected.revisions[1].status,"rejected");
  assert.equal(readActivePolicy(rejected,orgA).revision,1);
  assert.throws(()=>accept(rejected),/Only the current draft/);
});

test("a new approval invalidates the active predecessor without rewriting history",()=>{
  const old=accept(begin());
  const draft=submitPolicyDraft(old,{organizationId:orgA,submittedBy:creator,
    policy:policy(2),expectedRevision:1,expectedSha256:old.revisions[0].policySha256});
  const next=accept(draft);
  assert.equal(next.activeRevision,2);
  assert.equal(readActivePolicy(next,orgA).revision,2);
  assert.equal(next.revisions[0].status,"approved");
  assert.equal(old.activeRevision,1);
  assert.notEqual(next.revisions[1].policySha256,old.revisions[0].policySha256);
});

test("same company rejects stale revision and conflicting mutation",()=>{
  const first=begin();
  assert.throws(()=>submitPolicyDraft(first,{organizationId:orgA,submittedBy:creator,
    policy:policy(2),expectedRevision:0,expectedSha256:null}),/Stale/);
  assert.throws(()=>submitPolicyDraft(first,{organizationId:orgA,submittedBy:creator,
    policy:policy(2),expectedRevision:1,expectedSha256:first.revisions[0].policySha256}),
    /draft must be reviewed/);
  assert.throws(()=>reviewPolicyDraft(first,{
    organizationId:orgA,reviewedBy:reviewer,decision:"approve",
    expectedRevision:1,expectedSha256:"0".repeat(64),
  }),/Stale/);
});

test("cross-organization reads, approval and submissions fail closed",()=>{
  const a=begin(orgA),b=begin(orgB);
  assert.notEqual(a.organizationId,b.organizationId);
  assert.throws(()=>readActivePolicy(accept(a),orgB),/tenant does not match/);
  assert.throws(()=>reviewPolicyDraft(a,{
    organizationId:orgB,reviewedBy:reviewer,decision:"approve",
    expectedRevision:1,expectedSha256:a.revisions[0].policySha256,
  }),/tenant does not match/);
  assert.throws(()=>submitPolicyDraft(accept(a),{
    organizationId:orgB,submittedBy:creator,policy:policy(2),
    expectedRevision:1,expectedSha256:a.revisions[0].policySha256,
  }),/tenant does not match/);
});

test("historical policy snapshot and future read outputs cannot mutate source",()=>{
  const input=policy(); const draft=submitPolicyDraft(null,{
    organizationId:orgA,submittedBy:creator,policy:input,
    expectedRevision:0,expectedSha256:null,
  });
  input.pricing.services.office.rateCents=1;
  assert.equal(draft.revisions[0].policy.pricing.services.office.rateCents,7000);
  const approved=accept(draft);
  const read=readActivePolicy(approved,orgA);
  read.pricing.services.office.rateCents=2;
  assert.equal(readActivePolicy(approved,orgA).pricing.services.office.rateCents,7000);
  approved.revisions[0].policy.pricing.services.office.rateCents=1;
  assert.throws(()=>readActivePolicy(approved,orgA),/integrity/);
});

test("invalid pending services, tax and company exclusions cannot be approved",()=>{
  const bad=[
    {...policy(),pricing:{...policy().pricing,services:{office:{
      label:"",unit:"visit",rateCents:7000,billing:"charged",
    }}}},
    {...policy(),tax:{method:"none",bps:800}},
    {...policy(),excludedServiceCodes:["unknown"]},
    {...policy(),unitDirectCostsCents:{office:-1}},
    {...policy(),pricing:{...policy().pricing,services:{office:{
      label:"Office",unit:"visit",rateCents:5,billing:"imagined",
    }}}},
  ];
  for(const item of bad)assert.throws(()=>submitPolicyDraft(null,{
    organizationId:orgA,submittedBy:creator,policy:item,
    expectedRevision:0,expectedSha256:null,
  }));
});

test("a rejected first draft produces no approvable active policy",()=>{
  const rejected=accept(begin(),"reject");
  assert.equal(rejected.activeRevision,null);
  assert.throws(()=>readActivePolicy(rejected,orgA),/No approved/);
});
