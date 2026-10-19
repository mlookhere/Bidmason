import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {submitPolicyDraft,reviewPolicyDraft} from "../lib/company-policy-revisions.ts";
import {changeReviewSelection,emptyReviewSelection,prepareReviewPreviewRequest} from "../lib/intake-review-selection.ts";
import {readTenantIntakeWorkbench,previewTenantIntakeSelection} from "../lib/tenant-intake-service.ts";

const A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S="11111111-1111-4111-8111-111111111111";
const S2="22222222-2222-4222-8222-222222222222";
const AUTHOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const APPROVER="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const original={kind:"typed-note",text:"Clean office; polish floor"};
const candidates=[{serviceCode:"office",units:1,excerpt:"Clean office"},
 {serviceCode:"floor",units:1,excerpt:"polish floor"}]
 .map(c=>({...c,start:original.text.indexOf(c.excerpt),end:original.text.indexOf(c.excerpt)+c.excerpt.length}));
const review=prepareExtractionReview(original,candidates);
const policy=rev=>({revision:rev,pricing:{policyId:"clean-"+rev,currency:"USD",
 minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
 services:{office:{label:"Clean",unit:"job",rateCents:7000,billing:"charged"},
 floor:{label:"Floor",unit:"job",rateCents:2000,billing:"charged",optionalAddon:true}}},
 tax:{method:"none",bps:0}});
function approved(org){const d=submitPolicyDraft(null,{organizationId:org,submittedBy:AUTHOR,
 policy:policy(1),expectedRevision:0,expectedSha256:null});
 return reviewPolicyDraft(d,{organizationId:org,reviewedBy:APPROVER,decision:"approve",
 expectedRevision:1,expectedSha256:d.revisions[0].policySha256});}
function fixture(){
 const records=new Map([[S,{organizationId:A,sourceId:S,revision:1,original,review}],
 [S2,{organizationId:B,sourceId:S2,revision:1,original,review}]]);
 const rates=new Map([[A,approved(A)],[B,approved(B)]]);
 const grants=new Map([["a",A],["b",B]]);
 let sourceReads=0,policyReads=0,hook=()=>{};
 const sourceStore={async readAuthorized({session,organizationId,sourceId}){
   sourceReads++;
   if(grants.get(session)!==organizationId)throw Error("Source membership revoked or unauthorized");
   const data=structuredClone(records.get(sourceId)??null);
   hook({sourceReads,grants,records,rates});return data;
 }};
 const policyStore={async readAuthorized({session,organizationId}){
   policyReads++;
   if(grants.get(session)!==organizationId)throw Error("Policy membership revoked or unauthorized");
   return structuredClone(rates.get(organizationId)??null);
 }};
 return {sourceStore,policyStore,records,rates,grants,onRead:f=>hook=f,
 count:()=>({sourceReads,policyReads})};
}
const selector={organizationId:A,sourceId:S};
async function selected(f,addon=false){
 const model=await readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector);
 let state=changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"select",index:0,checked:true});
 if(addon){state=changeReviewSelection(model,state,{type:"select",index:1,checked:true});
 state=changeReviewSelection(model,state,{type:"acknowledge-addon",serviceCode:"floor",checked:true});}
 return prepareReviewPreviewRequest(model,state);
}

test("tenant-owned source and approved policy yield preview-only pricing",async()=>{
 const f=fixture(),request=await selected(f,true);
 const result=await previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",{...selector,request});
 assert.equal(result.state,"preview-only");
 assert.equal(result.economics.quote.totalCents,9000);
 assert.equal(result.selectedServices[1].addonAccepted,true);
 assert.deepEqual(f.count(),{sourceReads:4,policyReads:4});
});
test("client-supplied original, policy and approval cannot override stored records",async()=>{
 const f=fixture(),request=await selected(f);
 const result=await previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
 {...selector,request,original:{kind:"typed-note",text:"One cent"},approved:true,
 policy:{pricing:{services:{office:{rateCents:1}}}}});
 assert.equal(result.economics.quote.totalCents,7000);
});
test("foreign member and cross-tenant source ID cannot expose an intake",async()=>{
 const f=fixture();
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"b",selector),/unauthorized/);
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",
 {organizationId:A,sourceId:S2}),/missing or inconsistent/);
});
test("invalid UUIDs fail before reaching any provider",async()=>{
 const f=fixture();
 for(const invalid of [{organizationId:A,sourceId:"../other"},
 {organizationId:"invalid",sourceId:S}]){
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",invalid),/Invalid tenant/);}
 assert.equal(f.count().sourceReads,0);
});
test("source revision changes mid-read invalidate review model",async()=>{
 const f=fixture();f.onRead(({sourceReads,records})=>{
 if(sourceReads===1)records.set(S,{...records.get(S),revision:2});});
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector),/changed during review/);
});
test("evidence changes without revision bump invalidate a preview",async()=>{
 const f=fixture(),request=await selected(f);
 f.onRead(({sourceReads,records})=>{if(sourceReads===3){
 const changed=structuredClone(records.get(S));changed.review.candidates[0].units=3;
 records.set(S,changed);}});
 await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
 {...selector,request}),/changed during preview/);
});
test("source access revoked mid-request fails closed",async()=>{
 const f=fixture(),request=await selected(f);
 f.onRead(({sourceReads,grants})=>{if(sourceReads===3)grants.delete("a")});
 await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
 {...selector,request}),/revoked or unauthorized/);
});
test("optional add-on cannot be charged without separate acknowledgement",async()=>{
 const f=fixture(),request=await selected(f);
 await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
 {...selector,request:{...request,selectedIndices:[0,1]}}),/acknowledgement/);
});
test("missing, wrong-tenant, unbounded and malformed records fail closed",async()=>{
 for(const mutate of [
  x=>{x.revision=0}, x=>{x.organizationId=B},
  x=>{x.original={...x.original,text:"x".repeat(65537)}},
  x=>{x.review={...x.review,candidates:Array(51).fill(x.review.candidates[0])}}
 ]){
 const f=fixture(),doc=structuredClone(f.records.get(S));mutate(doc);f.records.set(S,doc);
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector),/missing or inconsistent/);}
 const f=fixture();f.records.delete(S);
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector),/missing or inconsistent/);
});
test("a committed pending correction blocks both old workbench and price preview",async()=>{
 const f=fixture(),request=await selected(f);
 const current=structuredClone(f.records.get(S));
 current.revision++;
 current.scopeReview=null;
 current.pendingCorrection={state:"pending-authorized-activation",correctionSha256:"a".repeat(64)};
 f.records.set(S,current);
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector),
  /missing or inconsistent/);
 await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
  {...selector,request}),/missing or inconsistent/);
});

test("activated correction must not expose the old provider scope through preview",async()=>{
 const f=fixture(),request=await selected(f);
 const changed=structuredClone(f.records.get(S));
 changed.revision+=2;
 changed.pendingCorrection=null;
 changed.activatedCorrection={state:"awaiting-renewed-human-scope-review",
  sourceRevision:changed.revision,correctedReview:changed.review};
 f.records.set(S,changed);
 await assert.rejects(readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector),
  /missing or inconsistent/);
 await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
  {...selector,request}),/missing or inconsistent/);
});

test("completed corrected human scope cannot be quoted through original tenant workbench",async()=>{
 const f=fixture(),request=await selected(f);
 const current=structuredClone(f.records.get(S));
 // Persisted corrected-scope lifecycle keeps the original extraction intact
 // and may have NULL pending/activated state; old preview must still be denied.
 current.revision=5;
 current.pendingCorrection=null;
 current.activatedCorrection=null;
 current.correctedScopeReview={state:"reviewed-corrected-scope-internal-only",
  sourceRevision:5,selectedIndices:[0],reviewedBy:APPROVER};
 f.records.set(S,current);
 await assert.rejects(readTenantIntakeWorkbench(
  f.sourceStore,f.policyStore,"a",selector),/missing or inconsistent/);
 await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
  {...selector,request}),/missing or inconsistent/);
});

test("correction arriving between original tenant source reads invalidates preview",async()=>{
 const f=fixture(),request=await selected(f);
 let sourceReads=0;
 const source={readAuthorized:async input=>{
  const value=await f.sourceStore.readAuthorized(input);
  if(++sourceReads===1) {
   const changed=structuredClone(f.records.get(S));
   changed.correctedScopeReview={state:"reviewed-corrected-scope-internal-only"};
   f.records.set(S,changed);
  }
  return value;
 }};
 await assert.rejects(previewTenantIntakeSelection(
  source,f.policyStore,"a",{...selector,request}),/missing or inconsistent/);
});

test("null correction columns preserve legitimate original previews",async()=>{
 const f=fixture(),request=await selected(f);
 const current=structuredClone(f.records.get(S));
 current.pendingCorrection=null;
 current.activatedCorrection=null;
 current.correctedScopeReview=null;
 f.records.set(S,current);
 const model=await readTenantIntakeWorkbench(f.sourceStore,f.policyStore,"a",selector);
 assert.equal(model.state,"internal-review-only");
 const price=await previewTenantIntakeSelection(f.sourceStore,f.policyStore,"a",
  {...selector,request});
 assert.equal(price.economics.quote.totalCents,7000);
});
