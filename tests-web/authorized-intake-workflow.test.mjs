import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview } from "../lib/intake-review.ts";
import { submitPolicyDraft, reviewPolicyDraft } from "../lib/company-policy-revisions.ts";
import { emptyReviewSelection, changeReviewSelection,
  prepareReviewPreviewRequest } from "../lib/intake-review-selection.ts";
import { readAuthorizedReviewWorkbench, previewAuthorizedWorkbenchSelection }
  from "../lib/authorized-intake-workflow.ts";
import {buildReviewWorkbench} from "../lib/intake-review-workbench.ts";

const orgA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const author="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const approver="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const original={kind:"typed-note",text:"Clean 2 rooms; polish floor; quarterly care"};
const candidates=[
  {serviceCode:"clean",units:2,excerpt:"Clean 2 rooms"},
  {serviceCode:"floor",units:1,excerpt:"polish floor"},
  {serviceCode:"quarterly",units:1,excerpt:"quarterly care"},
].map(c=>({...c,start:original.text.indexOf(c.excerpt),
  end:original.text.indexOf(c.excerpt)+c.excerpt.length}));
const review=prepareExtractionReview(original,candidates);
const pricing=revision=>({revision,pricing:{
  policyId:"cleaning-"+revision,currency:"USD",
  minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
  services:{
    clean:{label:"Cleaning",unit:"room",rateCents:7000,billing:"charged"},
    floor:{label:"Floor polish",unit:"job",rateCents:2500,
      billing:"charged",optionalAddon:true},
    quarterly:{label:"Quarterly care",unit:"visit",rateCents:9000,
      billing:"pending"},
  },},tax:{method:"none",bps:0}});
function history(org=orgA,revision=1){
  const draft=submitPolicyDraft(null,{organizationId:org,submittedBy:author,
    policy:pricing(revision),expectedRevision:0,expectedSha256:null});
  return reviewPolicyDraft(draft,{organizationId:org,reviewedBy:approver,
    decision:"approve",expectedRevision:1,
    expectedSha256:draft.revisions[0].policySha256});
}
function setup(){
  const states=new Map([[orgA,history(orgA)],[orgB,history(orgB)]]);
  const access=new Map([["a",orgA],["b",orgB]]);
  let reads=0;
  let callback=()=>{};
  const store={async readAuthorized({organizationId,session}){
    ++reads;
    if(access.get(session)!==organizationId)throw Error("Unauthorized tenant policy access");
    const snapshot=structuredClone(states.get(organizationId)??null);
    callback({reads,organizationId,session,states,access});
    return snapshot;
  }};
  return {store,states,access,reads:()=>reads,onRead:fn=>{callback=fn}};
}
const ctx={organizationId:orgA,original,review};
async function selected(f,{addon=false,quarterly=false}={}){
  const model=await readAuthorizedReviewWorkbench(f.store,"a",ctx);
  let state=emptyReviewSelection(model.key);
  state=changeReviewSelection(model,state,{type:"select",index:0,checked:true});
  if(addon){
    state=changeReviewSelection(model,state,{type:"select",index:1,checked:true});
    state=changeReviewSelection(model,state,{type:"acknowledge-addon",serviceCode:"floor",checked:true});
  }
  if(quarterly)state.selectedIndices.push(2); // attempt malicious selection
  return prepareReviewPreviewRequest(model,state);
}

test("approved source-bound review loads with two authorized reads",async()=>{
  const f=setup();const model=await readAuthorizedReviewWorkbench(f.store,"a",ctx);
  assert.equal(model.state,"internal-review-only");
  assert.deepEqual(model.rows.map(x=>x.status),["available","optional","pending"]);
  assert.equal(f.reads(),2);
});

test("verified selections produce only an internal economics preview",async()=>{
  const f=setup();const request=await selected(f,{addon:true});
  const result=await previewAuthorizedWorkbenchSelection(f.store,"a",{...ctx,request});
  assert.equal(result.state,"preview-only");
  assert.equal(result.economics.quote.totalCents,16500);
  assert.equal(result.selectedServices[1].addonAccepted,true);
  assert.equal(f.reads(),4);
  assert.equal(Object.hasOwn(result,"send"),false);
});

test("different tenant sessions cannot load or preview another organization's intake",async()=>{
  const f=setup();
  await assert.rejects(readAuthorizedReviewWorkbench(f.store,"b",ctx),/Unauthorized/);
  const request=await selected(f);
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"b",{...ctx,request}),/Unauthorized/);
});

test("forged review key and unlisted model directives fail closed",async()=>{
  const f=setup();const request=await selected(f);
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request:{...request,reviewKey:"0".repeat(64)}
  }),/stale/);
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request:{...request,send:true}
  }),/Invalid internal preview request/);
});

test("pending, unacknowledged, or duplicated optional lines cannot enter a preview",async()=>{
  const f=setup();const request=await selected(f);
  for(const forged of [
    {...request,selectedIndices:[2]},
    {...request,selectedIndices:[0,1]},
    {...request,selectedIndices:[0,0]},
    {...request,acceptedAddonCodes:["floor"]},
  ]) await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request:forged
  }),/ineligible|acknowledgement|Duplicate|Unselected|incomplete/);
});

test("modified original evidence or candidate snapshots invalidate the key",async()=>{
  const f=setup();const request=await selected(f);
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,original:{...original,text:original.text+"!"},request,
  }),/immutable original/);
  const modified={...review,candidates:review.candidates.map(x=>({...x}))};
  modified.candidates[0].units=7;
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,review:modified,request
  }),/snapshot was modified/);
});

test("membership revoked between loader reads invalidates model access",async()=>{
  const f=setup();f.onRead(({reads,access})=>{if(reads===1)access.delete("a")});
  await assert.rejects(readAuthorizedReviewWorkbench(f.store,"a",ctx),/Unauthorized/);
});

test("membership revoked during preview invalidates result",async()=>{
  const f=setup();const request=await selected(f);
  f.onRead(({reads,access})=>{if(reads===3)access.delete("a")});
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request
  }),/Unauthorized/);
});

test("active pricing changes between preview reads invalidate result",async()=>{
  const f=setup();const request=await selected(f);
  f.onRead(({reads,states})=>{
    if(reads===3){
      const prior=states.get(orgA);
      const draft=submitPolicyDraft(prior,{organizationId:orgA,submittedBy:author,
        policy:pricing(2),expectedRevision:1,
        expectedSha256:prior.revisions.at(-1).policySha256});
      states.set(orgA,reviewPolicyDraft(draft,{organizationId:orgA,
        reviewedBy:approver,decision:"approve",expectedRevision:2,
        expectedSha256:draft.revisions.at(-1).policySha256}));
    }
  });
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request
  }),/changed during preview/);
});

test("stale client review key after rate-card revision cannot be reused",async()=>{
  const f=setup();const request=await selected(f);
  const prior=f.states.get(orgA);
  const draft=submitPolicyDraft(prior,{organizationId:orgA,submittedBy:author,
    policy:pricing(2),expectedRevision:1,
    expectedSha256:prior.revisions.at(-1).policySha256});
  f.states.set(orgA,reviewPolicyDraft(draft,{organizationId:orgA,
    reviewedBy:approver,decision:"approve",expectedRevision:2,
    expectedSha256:draft.revisions.at(-1).policySha256}));
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request
  }),/stale/);
});

test("draft-only or malformed policy history produces no workbench or preview",async()=>{
  const f=setup();const request=await selected(f);
  const previous=f.states.get(orgA);
  const draft=submitPolicyDraft(null,{organizationId:orgA,submittedBy:author,
    policy:pricing(1),expectedRevision:0,expectedSha256:null});
  f.states.set(orgA,draft);
  await assert.rejects(readAuthorizedReviewWorkbench(f.store,"a",ctx),/No approved/);
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
    ...ctx,request
  }),/No approved/);
  previous.revisions[0].policy.pricing.services.clean.rateCents=2;
  f.states.set(orgA,previous);
  await assert.rejects(readAuthorizedReviewWorkbench(f.store,"a",ctx),/integrity/);
});

test("canonical indices and add-on order across legacy preview paths",async()=>{
 const f=setup(),request=await selected(f,{addon:true});
 assert.deepEqual(request.selectedIndices,[0,1]);
 assert.deepEqual(request.acceptedAddonCodes,["floor"]);
 const wrong=[
   {...request,selectedIndices:[1,0]},
   {...request,selectedIndices:[0,0]},
   {...request,selectedIndices:[0,1.5]},
   {...request,selectedIndices:[0,Number.MAX_SAFE_INTEGER+1]},
   {...request,selectedIndices:Array.from({length:51},(_,i)=>i)},
   {...request,acceptedAddonCodes:["floor","floor"]},
   {...request,acceptedAddonCodes:["FLOOR"]},
 ];
 for(const invalid of wrong) {
   await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",{
     ...ctx,request:invalid,
   }),/noncanonical|incomplete/);
 }
 // The shared helper is also used by the legacy store-backed commit flow.
 const model=await readAuthorizedReviewWorkbench(f.store,"a",ctx);
 assert.throws(()=>prepareReviewPreviewRequest(model,{
   key:model.key,selectedIndices:[1,0],acceptedAddonCodes:["floor"],
 }),/noncanonical/);
});

test("multiple optional acknowledgements must use a single canonical order",()=>{
 const model=buildReviewWorkbench(original,review,{
   ...pricing(1),pricing:{
     ...pricing(1).pricing,services:{
       ...pricing(1).pricing.services,
       clean:{...pricing(1).pricing.services.clean,optionalAddon:true},
     },
   },
 });
 const correct={key:model.key,selectedIndices:[0,1],
   acceptedAddonCodes:["clean","floor"]};
 assert.deepEqual(prepareReviewPreviewRequest(model,correct).acceptedAddonCodes,
   ["clean","floor"]);
 assert.throws(()=>prepareReviewPreviewRequest(model,{
   ...correct,acceptedAddonCodes:["floor","clean"],
 }),/noncanonical/);
});


test("inner workbench uses one immutable evidence snapshot across both policy reads",async()=>{
 const f=setup(),mutable=structuredClone(ctx);
 f.onRead(({reads})=>{
  if(reads===1){
   mutable.organizationId=orgB;
   mutable.original.text="forged during policy lookup";
   mutable.review.candidates[0].units=500;
  }
 });
 const model=await readAuthorizedReviewWorkbench(f.store,"a",mutable);
 assert.equal(f.reads(),2);
 assert.equal(model.state,"internal-review-only");
 assert.deepEqual(model.rows.map(row=>row.serviceCode),["clean","floor","quarterly"]);
 assert.equal(model.rows[0].units,2);
});

test("inner preview freezes original, tenant and selection before first policy await",async()=>{
 const f=setup(),request=await selected(f);
 const mutable={...structuredClone(ctx),request:structuredClone(request)};
 f.onRead(({reads})=>{
  if(reads===3){
   mutable.organizationId=orgB;
   mutable.original.text="unverified one-cent service";
   mutable.review.candidates[0].units=500;
   mutable.request.reviewKey="0".repeat(64);
   mutable.request.selectedIndices[0]=1;
   mutable.request.acceptedAddonCodes.push("floor");
  }
 });
 const preview=await previewAuthorizedWorkbenchSelection(f.store,"a",mutable);
 assert.equal(preview.state,"preview-only");
 assert.equal(preview.economics.quote.totalCents,14000);
 assert.deepEqual(preview.selectedServices.map(row=>row.serviceCode),["clean"]);
 assert.equal(f.reads(),4);
});

test("direct review preview rejects accessor, symbolic and sparse inputs before policy reads",async()=>{
 const f=setup(),request=await selected(f),start=f.reads();
 let getterCalls=0;
 const getterCtx={...ctx,request};
 Object.defineProperty(getterCtx,"organizationId",{enumerable:true,
  get(){getterCalls++;throw Error("untrusted tenant getter");}});
 const hidden={...ctx,request:{...request}};
 Object.defineProperty(hidden.request,"approved",{value:true});
 const symbolic={...ctx,request:{...request}};
 symbolic.request[Symbol("send")]=true;
 const selectedGetter={...ctx,request:{...request,selectedIndices:[0]}};
 Object.defineProperty(selectedGetter.request.selectedIndices,"0",{enumerable:true,
  get(){getterCalls++;throw Error("untrusted index getter");}});
 const sparse={...ctx,request:{...request,selectedIndices:new Array(1)}};
 const accessorKey={...ctx,request:{...request}};
 Object.defineProperty(accessorKey.request,"reviewKey",{enumerable:true,
  get(){getterCalls++;throw Error("untrusted review key getter");}});
 for(const invalid of [getterCtx,hidden,symbolic,selectedGetter,sparse,accessorKey]){
  await assert.rejects(previewAuthorizedWorkbenchSelection(f.store,"a",invalid),
   /Invalid internal review source context|Invalid internal preview request/);
 }
 assert.equal(f.reads(),start);
 assert.equal(getterCalls,0);
});
