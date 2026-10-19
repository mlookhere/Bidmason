import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {prepareExtractionCorrectionDraft} from "../lib/extraction-correction-draft.ts";
import {submitPolicyDraft,reviewPolicyDraft} from "../lib/company-policy-revisions.ts";
import {readExtractionCorrectionContext,commitAuthorizedExtractionCorrection,
 readExtractionActivationContext,commitAuthorizedExtractionActivation}
 from "../lib/tenant-extraction-correction.ts";
import {readCorrectedScopeContext,commitAuthorizedCorrectedScopeReview}
 from "../lib/tenant-corrected-scope-review.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE="11111111-1111-4111-8111-111111111111";
const WRITER="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTIVATOR="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REVIEWER="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const APPROVER="ffffffff-ffff-4fff-8fff-ffffffffffff";
const original={kind:"typed-note",text:"Clean 2 rooms; polish floors"};
const first={serviceCode:"rooms",units:2,start:0,end:13,excerpt:"Clean 2 rooms"};
const second={serviceCode:"floor",units:1,start:15,end:28,excerpt:"polish floors"};
const changes=[{action:"replace",index:0,candidate:{...first,units:3},
 reason:"Checked the work order and verified three rooms"}];
const selector={organizationId:ORG,sourceId:SOURCE};
const policy=n=>({revision:n,pricing:{policyId:"clean-"+n,currency:"USD",
 minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
 services:{rooms:{label:"Room cleaning",unit:"room",rateCents:7000,billing:"charged"},
 floor:{label:"Floor care",unit:"job",rateCents:2000,billing:"charged",optionalAddon:true}}},
 tax:{method:"none",bps:0}});
function history(n=1){
 let h=null;
 for(let i=1;i<=n;i++){
  h=submitPolicyDraft(h,{organizationId:ORG,submittedBy:WRITER,
   expectedRevision:i-1,expectedSha256:h?.revisions.at(-1)?.policySha256??null,
   policy:policy(i)});
  h=reviewPolicyDraft(h,{organizationId:ORG,reviewedBy:APPROVER,
   decision:"approve",expectedRevision:i,
   expectedSha256:h.revisions.at(-1).policySha256});
 }
 return h;
}
function fixture(){
 const review=prepareExtractionReview(original,[first,second]);
 let record={organizationId:ORG,sourceId:SOURCE,revision:2,
  original:structuredClone(original),review:structuredClone(review),
  extractionAudit:[{sourceRevision:2,actorId:WRITER,
   sourceSha256:review.sourceSha256,candidatesSha256:review.candidatesSha256}],
  scopeReview:null,pendingCorrection:null,activatedCorrection:null,correctedScopeReview:null};
 let active=history(),queue=Promise.resolve(),reads=0,writes=0;
 let afterWrite=()=>{},afterPolicy=()=>{},afterRead=()=>{};
 const sessions=new Map([
  ["corrector",{org:ORG,actor:WRITER,perm:"correct-extraction"}],
  ["activator",{org:ORG,actor:ACTIVATOR,perm:"activate-extraction-correction"}],
  ["reviewer",{org:ORG,actor:REVIEWER,perm:"review-corrected-extraction"}],
  ["viewer",{org:ORG,actor:REVIEWER,perm:"none"}],
  ["foreign",{org:FOREIGN,actor:REVIEWER,perm:"review-corrected-extraction"}]]);
 const auth=(session,org,perm)=>{const role=sessions.get(session);
  if(!role||role.org!==org||(perm&&role.perm!==perm))throw Error("Unauthorized");
  return role.actor;};
 const store={
  async readAuthorized({session,organizationId,sourceId}){
   reads++;auth(session,organizationId);afterRead();
   return sourceId===SOURCE?structuredClone(record):null;
  },
  mutateAuthorized({session,organizationId,sourceId,permission,transform}){
   const task=queue.catch(()=>{}).then(()=>{writes++;
    const actor=auth(session,organizationId,permission);
    const next=transform(sourceId===SOURCE?structuredClone(record):null,actor);
    record=structuredClone(next);afterWrite();
    return structuredClone(next);
   });
   queue=task.then(()=>{},()=>{});return task;
  },
 };
 const policyStore={async readAuthorized({session,organizationId}){
  auth(session,organizationId);afterPolicy();
  return structuredClone(active);
 }};
 return {store,policyStore,get:()=>structuredClone(record),
  update:fn=>{const v=structuredClone(record);fn(v);record=v;},
  setPolicy:n=>{active=history(n)},sessions,
  hooks:{write:fn=>afterWrite=fn,policy:fn=>afterPolicy=fn,read:fn=>afterRead=fn},
  counts:()=>({reads,writes})};
}
async function activated(f){
 const orig=await readExtractionCorrectionContext(f.store,"corrector",selector);
 const draft=prepareExtractionCorrectionDraft(original,f.get().review,changes);
 await commitAuthorizedExtractionCorrection(f.store,"corrector",{
  ...selector,expectedRevision:orig.expectedRevision,
  expectedSnapshotSha256:orig.expectedSnapshotSha256,
  expectedCorrectionSha256:draft.correctionSha256,changes});
 const ctx=await readExtractionActivationContext(f.store,"activator",selector);
 await commitAuthorizedExtractionActivation(f.store,"activator",{
  ...selector,expectedRevision:ctx.expectedRevision,
  expectedSnapshotSha256:ctx.expectedSnapshotSha256,
  expectedCorrectionSha256:ctx.expectedCorrectionSha256});
}
async function request(f,extra={}){
 const ctx=await readCorrectedScopeContext(f.store,f.policyStore,"reviewer",selector);
 return {...selector,expectedRevision:ctx.expectedRevision,
  expectedSnapshotSha256:ctx.expectedSnapshotSha256,
  activationSha256:ctx.activationSha256,
  reviewKey:ctx.model.key,selectedIndices:[0],acceptedAddonCodes:[],...extra};
}
test("renewed human selection commits separately from original model scope and pricing",async()=>{
 const f=fixture();await activated(f);const before=f.get();
 const req=await request(f),result=await commitAuthorizedCorrectedScopeReview(
  f.store,f.policyStore,"reviewer",req);
 assert.equal(result.state,"reviewed-corrected-scope-internal-only");
 assert.equal(result.revision,5);
 assert.equal(result.reviewedBy,REVIEWER);
 const row=f.get();
 assert.deepEqual(row.original,before.original);
 assert.deepEqual(row.review,before.review);
 assert.deepEqual(row.extractionAudit,before.extractionAudit);
 assert.deepEqual(row.activatedCorrection,before.activatedCorrection);
 assert.equal(row.scopeReview,null);
 assert.equal(row.pendingCorrection,null);
 assert.equal(row.correctedScopeReview.sourceRevision,5);
 assert.equal(row.correctedScopeReview.activationSha256,req.activationSha256);
 assert.equal(row.correctedScopeReview.policyRevision,1);
 assert.deepEqual(row.correctedScopeReview.selectedIndices,[0]);
 assert.equal(row.activatedCorrection.correctedReview.candidates[0].units,3);
 assert.equal(Object.hasOwn(row.correctedScopeReview,"quoteTotalCents"),false);
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
});
test("optional corrected addon requires explicit acknowledgement",async()=>{
 const f=fixture();await activated(f);
 const req=await request(f,{selectedIndices:[0,1]});
 await assert.rejects(commitAuthorizedCorrectedScopeReview(
  f.store,f.policyStore,"reviewer",req),/acknowledgement/);
 const ok=await commitAuthorizedCorrectedScopeReview(f.store,f.policyStore,
  "reviewer",{...req,acceptedAddonCodes:["floor"]});
 assert.equal(ok.state,"reviewed-corrected-scope-internal-only");
 assert.deepEqual(f.get().correctedScopeReview.acceptedAddonCodes,["floor"]);
});
test("concurrent reviewers cannot commit twice or restore original scope",async()=>{
 const f=fixture();await activated(f);const req=await request(f);
 const outcomes=await Promise.allSettled([
  commitAuthorizedCorrectedScopeReview(f.store,f.policyStore,"reviewer",req),
  commitAuthorizedCorrectedScopeReview(f.store,f.policyStore,"reviewer",req)]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
 assert.equal(f.get().revision,5);
 assert.equal(f.get().scopeReview,null);
 await assert.rejects(readCorrectedScopeContext(
  f.store,f.policyStore,"reviewer",selector),/already reviewed/);
});
test("revoked, wrong tenant and view-only sessions cannot commit",async()=>{
 const f=fixture();await activated(f);const req=await request(f);
 for(const s of ["foreign","viewer"]){
  await assert.rejects(commitAuthorizedCorrectedScopeReview(
   f.store,f.policyStore,s,req),/Unauthorized/);
 }
 f.sessions.delete("reviewer");
 await assert.rejects(commitAuthorizedCorrectedScopeReview(
  f.store,f.policyStore,"reviewer",req),/Unauthorized/);
 assert.equal(f.get().correctedScopeReview,null);
});
test("policy changes and malformed selections fail closed",async()=>{
 const f=fixture();await activated(f);const req=await request(f);
 f.setPolicy(2);
 await assert.rejects(commitAuthorizedCorrectedScopeReview(
  f.store,f.policyStore,"reviewer",req),/policy|key changed/);
 f.setPolicy(1);
 for(const change of [{...req,selectedIndices:[1,0],acceptedAddonCodes:["floor"]},
  {...req,selectedIndices:[0,0]},
  {...req,acceptedAddonCodes:["floor"]},
  {...req,expectedSnapshotSha256:"0".repeat(64)},
  {...req,activationSha256:"0".repeat(64)},
  {...req,approved:true},{...req,actorId:REVIEWER}]){
  await assert.rejects(commitAuthorizedCorrectedScopeReview(
   f.store,f.policyStore,"reviewer",change));
 }
 assert.equal(f.get().correctedScopeReview,null);
});
test("tampered original, original audit and activated correction lineage are rejected",async()=>{
 for(const mutation of [
  row=>{row.review.candidates[0].units=99},
  row=>{row.extractionAudit[0].candidatesSha256="0".repeat(64)},
  row=>{row.activatedCorrection.correctedReview.candidates[0].units=12},
  row=>{row.activatedCorrection.activationSha256="0".repeat(64)},
  row=>{row.activatedCorrection.priorCorrection.changes[0].reason="forged"},
  row=>{row.activatedCorrection.priorCorrection.invalidatedScopeReview={approved:true}},
 ]){
  const f=fixture();await activated(f);const before=f.get();f.update(mutation);
  await assert.rejects(readCorrectedScopeContext(
   f.store,f.policyStore,"reviewer",selector));
  assert.equal(f.get().correctedScopeReview,null);
  assert.equal(f.get().revision,before.revision);
 }
});
test("write response forgery, read-back denial, and policy drift never confirm",async()=>{
 for(const mode of ["fake","revoke","policy"]){
  const f=fixture();await activated(f);const req=await request(f);
  if(mode==="fake"){
   f.store.mutateAuthorized=async opts=>opts.transform(f.get(),REVIEWER);
  }else if(mode==="revoke"){
   f.hooks.write(()=>f.sessions.delete("reviewer"));
  }else{
   f.hooks.write(()=>f.setPolicy(2));
  }
  await assert.rejects(commitAuthorizedCorrectedScopeReview(
   f.store,f.policyStore,"reviewer",req));
  if(mode==="fake")assert.equal(f.get().correctedScopeReview,null);
 }
});
test("invalid hidden and accessor request fields do not execute getters",async()=>{
 const f=fixture();await activated(f);const req=await request(f);
 let called=0;
 const hidden={...req};Object.defineProperty(hidden,"send",{value:true});
 const getter={...req};Object.defineProperty(getter,"reviewKey",{
  enumerable:true,get(){called++;return req.reviewKey}});
 for(const item of [hidden,getter]){
  await assert.rejects(commitAuthorizedCorrectedScopeReview(
   f.store,f.policyStore,"reviewer",item),/Invalid corrected scope commit request/);
 }
 assert.equal(called,0);
 assert.equal(f.get().correctedScopeReview,null);
});
