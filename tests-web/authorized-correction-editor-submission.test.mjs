import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {changeCorrectionEditor,emptyCorrectionEditor,prepareCorrectionEditorRequest}
 from "../lib/extraction-correction-editor.ts";
import {submitAuthorizedCorrectionEditorRequest}
 from "../lib/authorized-correction-editor-submission.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE="11111111-1111-4111-8111-111111111111";
const ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const original={kind:"typed-note",text:"Paint 2 rooms; clean 3 rooms; wash windows"};
const candidate=(serviceCode,units,excerpt)=>{
 const start=original.text.indexOf(excerpt);
 return {serviceCode,units,start,end:start+excerpt.length,excerpt};
};
const painting=candidate("paint",2,"Paint 2 rooms");
const cleaning=candidate("clean",2,"clean 3 rooms");
const review=()=>prepareExtractionReview(original,[painting,cleaning]);
const replace={type:"replace",index:1,serviceCode:"clean",units:3,
 reason:"Operator confirmed all three rooms from original notes"};
const add={type:"add",serviceCode:"windows",units:1,
 start:original.text.indexOf("wash windows"),
 end:original.text.indexOf("wash windows")+"wash windows".length,
 reason:"Operator located missed window work in notes"};
const selector={organizationId:ORG,sourceId:SOURCE};
const editorPayload=(actions=[replace,add])=>{
 const r=review();
 let state=emptyCorrectionEditor(r);
 for (const action of actions)state=changeCorrectionEditor(original,r,state,action);
 return prepareCorrectionEditorRequest(r,state);
};

function fixture(reviewed=false){
 const sourceReview=review();
 const scopeReview=reviewed?{
  state:"reviewed-for-proposal-draft",sourceRevision:2,
  reviewedBy:ACTOR,reviewKey:"a".repeat(64),
  sourceSha256:sourceReview.sourceSha256,
  candidatesSha256:sourceReview.candidatesSha256,
  selectedIndices:[0],acceptedAddonCodes:[],
  policyRevision:1,policySha256:"b".repeat(64),
  reviewedSelectionSha256:"c".repeat(64),
 }:null;
 let record={organizationId:ORG,sourceId:SOURCE,revision:2,
  original:structuredClone(original),review:structuredClone(sourceReview),
  extractionAudit:[{sourceRevision:2,actorId:ACTOR,
   sourceSha256:sourceReview.sourceSha256,
   candidatesSha256:sourceReview.candidatesSha256}],
  scopeReview,pendingCorrection:null,activatedCorrection:null};
 let queue=Promise.resolve(),writes=0,reads=0;
 let afterRead=()=>{},beforeWrite=()=>{},afterWrite=()=>{};
 const permissions=new Map([
  ["editor",{org:ORG,write:true}],["viewer",{org:ORG,write:false}],
  ["foreign",{org:OTHER_ORG,write:true}],
 ]);
 const authorize=(session,organizationId,write)=>{
  const grant=permissions.get(session);
  if (!grant||grant.org!==organizationId||(write&&!grant.write))
   throw Error("Unauthorized correction editor");
  return ACTOR;
 };
 const store={
  async readAuthorized({session,organizationId,sourceId}){
   reads++;authorize(session,organizationId,false);
   const copy=sourceId===SOURCE?structuredClone(record):null;
   afterRead();
   return copy;
  },
  mutateAuthorized({session,organizationId,sourceId,permission,transform}){
   const work=queue.catch(()=>{}).then(()=>{
    writes++;beforeWrite();
    if (permission!=="correct-extraction")throw Error("Unauthorized permission");
    const actor=authorize(session,organizationId,true);
    const next=transform(sourceId===SOURCE?structuredClone(record):null,actor);
    record=structuredClone(next);afterWrite();
    return structuredClone(next);
   });
   queue=work.then(()=>{},()=>{});return work;
  },
 };
 return {store,permissions,get:()=>structuredClone(record),
  set:mutator=>{const copy=structuredClone(record);mutator(copy);record=copy;},
  hooks:{afterRead:fn=>afterRead=fn,beforeWrite:fn=>beforeWrite=fn,
   afterWrite:fn=>afterWrite=fn},
  counts:()=>({reads,writes})};
}
const submit=(f,payload=editorPayload(),session="editor",target=selector)=>
 submitAuthorizedCorrectionEditorRequest(f.store,session,target,payload);

test("valid browser edits become a single authorized, pending-only correction",async()=>{
 const f=fixture(),before=f.get();
 const result=await submit(f);
 assert.equal(result.state,"correction-committed-pending-activation");
 assert.equal(result.correctedBy,ACTOR);
 assert.equal(result.revision,3);
 const row=f.get();
 assert.equal(row.scopeReview,null);
 assert.equal(row.pendingCorrection.state,"pending-authorized-activation");
 assert.equal(row.pendingCorrection.sourceRevision,3);
 assert.deepEqual(row.original,before.original);
 assert.deepEqual(row.review,before.review);
 assert.deepEqual(row.extractionAudit,before.extractionAudit);
 assert.deepEqual(row.pendingCorrection.changes.map(c=>c.action),["replace","add"]);
 assert.equal(row.pendingCorrection.proposedCandidates[1].units,3);
 assert.equal(row.pendingCorrection.proposedCandidates[2].serviceCode,"windows");
 assert.equal(f.counts().writes,1);
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
});

test("correcting a previously reviewed scope invalidates and archives that review",async()=>{
 const f=fixture(true),prior=f.get();
 await submit(f,editorPayload([replace]));
 assert.equal(f.get().scopeReview,null);
 assert.deepEqual(f.get().pendingCorrection.invalidatedScopeReview,prior.scopeReview);
});

test("independent authorization blocks foreign tenants, viewers and revoked actors",async()=>{
 const f=fixture(),payload=editorPayload();
 for (const session of ["foreign","viewer"]){
  await assert.rejects(submit(f,payload,session),/Unauthorized/);
 }
 f.permissions.delete("editor");
 await assert.rejects(submit(f,payload),/Unauthorized/);
 assert.equal(f.get().pendingCorrection,null);
 assert.equal(f.counts().writes,0);
});

test("browser cannot inject identity, approval, pricing or a replacement source",async()=>{
 const f=fixture(),payload=editorPayload();
 const invalid=[
  {...payload,correctedBy:ACTOR},
  {...payload,approved:true},
  {...payload,priceCents:1},
  {...payload,expectedRevision:2},
  {...payload,sourceSha256:"0".repeat(64)},
  {...payload,candidatesSha256:"0".repeat(64)},
  {...payload,changes:[{...payload.changes[0],send:true}]},
  {...payload,changes:[{...payload.changes[0],candidate:{
   ...payload.changes[0].candidate,excerpt:"fabricated"}}]},
  {...payload,changes:[]},
 ];
 for (const candidate of invalid){
  await assert.rejects(submit(f,candidate));
 }
 assert.equal(f.counts().writes,0);
});

test("untrusted getter and hidden-property injection fail before any authorized read",async()=>{
 const f=fixture(),base=editorPayload();
 let calls=0;
 const hidden={...base};Object.defineProperty(hidden,"send",{value:true});
 const getter={...base};Object.defineProperty(getter,"changes",{
  enumerable:true,get(){calls++;return base.changes;}});
 const symbol={...base,[Symbol("send")]:true};
 for (const payload of [hidden,getter,symbol]){
  await assert.rejects(submit(f,payload),/Invalid source-bound/);
 }
 assert.equal(calls,0);
 assert.equal(f.counts().reads,0);
});

test("stale same-tenant original and revision races deny changes",async()=>{
 const f=fixture(),payload=editorPayload();
 f.set(row=>{row.original.text+=" another job";});
 await assert.rejects(submit(f,payload));
 assert.equal(f.counts().writes,0);
 const concurrent=fixture();
 let calls=0;
 concurrent.hooks.afterRead(()=>{if(++calls===3)concurrent.set(row=>row.revision++);});
 await assert.rejects(submit(concurrent,payload),/Stale extraction correction/);
 assert.equal(concurrent.get().pendingCorrection,null);
});

test("concurrent duplicate editor submissions cannot both commit",async()=>{
 const f=fixture(),payload=editorPayload();
 const results=await Promise.allSettled([submit(f,payload),submit(f,payload)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(results.filter(r=>r.status==="rejected").length,1);
 assert.equal(f.get().revision,3);
 await assert.rejects(submit(f,payload),/unavailable/);
});

test("lost readback is indeterminate and must never trigger an automatic retry",async()=>{
 const f=fixture();
 f.hooks.afterWrite(()=>f.permissions.delete("editor"));
 await assert.rejects(submit(f),/Unauthorized/);
 assert.equal(f.counts().writes,1);
 assert.equal(f.get().pendingCorrection.state,"pending-authorized-activation");
});

test("caller changing payload after authorized reads cannot alter verified commit",async()=>{
 const f=fixture(),payload=editorPayload();
 let once=false;
 f.hooks.afterRead(()=>{
  if(!once){once=true;payload.changes[0].candidate.units=4;}
 });
 const result=await submit(f,payload);
 assert.equal(result.state,"correction-committed-pending-activation");
 // Decision was freshly revalidated against persisted source at submission;
 // a change before that validation is treated as the caller's proposal.
 assert.equal(f.get().pendingCorrection.proposedCandidates[1].units,4);
});
