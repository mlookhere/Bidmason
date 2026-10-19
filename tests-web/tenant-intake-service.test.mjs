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
 const changed=structuredClone(records.get(S));
 // Simulate a fresh internally consistent review replacing the prior
 // snapshot without a revision bump; the second read must still detect it.
 changed.review=prepareExtractionReview(changed.original,
   changed.review.candidates.map((row,i)=>i===0?{...row,units:3}:row));
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


test("tenant workbench uses original source identity across both authorized reads",async()=>{
 const f=fixture(),mutable={...selector};
 f.onRead(({sourceReads})=>{
  if(sourceReads===1){mutable.organizationId=B;mutable.sourceId=S2;}
 });
 const model=await readTenantIntakeWorkbench(
  f.sourceStore,f.policyStore,"a",mutable);
 assert.equal(model.state,"internal-review-only");
 assert.equal(f.count().sourceReads,2);
 assert.equal(f.count().policyReads,2);
});

test("preview request, source and tenant identities remain bound across async reads",async()=>{
 const f=fixture(),request=await selected(f);
 const mutable={...selector,request};
 f.onRead(({sourceReads})=>{
  if(sourceReads===3){
   mutable.organizationId=B;
   mutable.sourceId=S2;
   mutable.request.reviewKey="0".repeat(64);
   mutable.request.selectedIndices[0]=1;
   mutable.request.acceptedAddonCodes.push("floor");
  }
 });
 const result=await previewTenantIntakeSelection(
  f.sourceStore,f.policyStore,"a",mutable);
 assert.equal(result.state,"preview-only");
 assert.equal(result.economics.quote.totalCents,7000);
 assert.deepEqual(result.selectedServices.map(row=>row.serviceCode),["office"]);
 assert.equal(f.count().sourceReads,4);
 assert.equal(f.count().policyReads,4);
});

test("tenant preview rejects accessor-backed selectors and forged review data before any authorized read",async()=>{
 const f=fixture(),request=await selected(f),before=f.count().sourceReads;
 let called=0;
 const selectorGetter={...selector,request};
 Object.defineProperty(selectorGetter,"sourceId",{enumerable:true,
  get(){called++;throw Error("untrusted source getter");}});
 const requestGetter={...selector,request:{...request}};
 Object.defineProperty(requestGetter.request,"reviewKey",{enumerable:true,
  get(){called++;throw Error("untrusted key getter");}});
 const indexGetter={...selector,request:{...request,selectedIndices:[0]}};
 Object.defineProperty(indexGetter.request.selectedIndices,"0",{enumerable:true,
  get(){called++;throw Error("untrusted index getter");}});
 const hidden={...selector,request:{...request}};
 Object.defineProperty(hidden.request,"send",{value:true});
 const decorated={...selector,request:{...request,acceptedAddonCodes:[]}};
 Object.defineProperty(decorated.request.acceptedAddonCodes,"send",{value:true});
 const symbolic={...selector,request:{...request}};
 symbolic.request[Symbol("approval")]=true;
 for(const invalid of [selectorGetter,requestGetter,indexGetter,hidden,decorated,symbolic]){
  await assert.rejects(previewTenantIntakeSelection(f.sourceStore,f.policyStore,
   "a",invalid),/Invalid tenant intake record selector|Invalid internal preview request/);
 }
 assert.equal(called,0);
 assert.equal(f.count().sourceReads,before);
});


test("tenant record rejects unsafe stored fields before executing getters or reading policy",async()=>{
 const f=fixture();
 const request=await selected(f);
 const baseline=f.count().policyReads;
 let getters=0,reads=0;
 const mutations=[
  x=>Object.defineProperty(x,"organizationId",{enumerable:true,
    get(){getters++;throw Error("unsafe stored tenant");}}),
  x=>Object.defineProperty(x,"revision",{enumerable:true,
    get(){getters++;throw Error("unsafe stored revision");}}),
  x=>Object.defineProperty(x,"original",{enumerable:true,
    get(){getters++;throw Error("unsafe stored original");}}),
  x=>Object.defineProperty(x.original,"text",{enumerable:true,
    get(){getters++;throw Error("unsafe original text");}}),
  x=>Object.defineProperty(x,"review",{enumerable:true,
    get(){getters++;throw Error("unsafe stored review");}}),
  x=>Object.defineProperty(x.review,"candidates",{enumerable:true,
    get(){getters++;throw Error("unsafe review candidates");}}),
  x=>Object.defineProperty(x.review.candidates,"0",{enumerable:true,
    get(){getters++;throw Error("unsafe candidate index");}}),
  x=>Object.defineProperty(x.review.candidates[0],"units",{enumerable:true,
    get(){getters++;throw Error("unsafe candidate units");}}),
  x=>{delete x.review.candidates[0];},
  x=>{x.review.candidates[Symbol("approved")]=true;},
  x=>{x.review.candidates[0][Symbol("send")]=true;},
  x=>Object.defineProperty(x.review,"hiddenApproval",{value:true}),
  x=>Object.defineProperty(x.review.candidates[0],"toJSON",{
    value(){getters++;throw Error("unsafe candidate serializer");}}),
  x=>{x.review.candidatesSha256="0".repeat(64);},
  x=>{x.review.candidates[0].units=9;},
 ];
 for(const mutate of mutations){
  const value=structuredClone(f.records.get(S));
  mutate(value);
  const sourceStore={readAuthorized:async()=>{
    reads++;return value;
  }};
  for(const run of [
   ()=>readTenantIntakeWorkbench(sourceStore,f.policyStore,"a",selector),
   ()=>previewTenantIntakeSelection(sourceStore,f.policyStore,"a",{
     ...selector,request,
   }),
  ]) {
   await assert.rejects(run(),/Tenant-owned intake record missing or inconsistent/);
  }
 }
 assert.equal(reads,2*mutations.length);
 assert.equal(getters,0);
 assert.equal(f.count().policyReads,baseline);
});

test("canonical null-prototype tenant records preserve source-bound preview checks",async()=>{
 const f=fixture();
 const record=structuredClone(f.records.get(S));
 const originalNull=Object.assign(Object.create(null),record.original);
 const reviewNull=Object.assign(Object.create(null),record.review);
 reviewNull.candidates=reviewNull.candidates.map(row=>
  Object.assign(Object.create(null),row));
 const persisted=Object.assign(Object.create(null),{
  ...record,original:originalNull,review:reviewNull,
 });
 const sourceStore={readAuthorized:async()=>persisted};
 const model=await readTenantIntakeWorkbench(sourceStore,f.policyStore,"a",selector);
 assert.equal(model.rows[0].status,"available");
 const chosen=changeReviewSelection(model,emptyReviewSelection(model.key),{
  type:"select",index:0,checked:true,
 });
 const request=prepareReviewPreviewRequest(model,chosen);
 const preview=await previewTenantIntakeSelection(sourceStore,f.policyStore,"a",{
  ...selector,request,
 });
 assert.equal(preview.state,"preview-only");
 assert.equal(preview.economics.quote.totalCents,7000);
});
