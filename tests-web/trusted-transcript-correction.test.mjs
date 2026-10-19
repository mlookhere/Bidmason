import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {prepareTranscriptCorrectionDraft} from "../lib/transcript-clarification.ts";
import {readTranscriptCorrectionContext, commitAuthorizedTranscriptCorrection}
  from "../lib/trusted-transcript-correction.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE="11111111-1111-4111-8111-111111111111";
const ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RAW="Paint fifteen units, install forty fixtures.";
const corrections=[
  {uncertaintyIndex:0,replacement:"15",explanation:"Confirmed by reviewer"},
  {uncertaintyIndex:1,replacement:"40",explanation:"Confirmed from job notes"},
];
function outcome(){return {state:"needs-information",audioSha256:"a".repeat(64),
 providerName:"synthetic",providerVersion:"1",durationMs:4500,
 original:{kind:"transcript",text:RAW,transcriptionSucceeded:false},
 uncertainties:[
   {start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"},
   {start:29,end:34,excerpt:"forty",reason:"unclear-speech"}],segments:[]};}
function fixture(){
 const db={organizationId:ORG,sourceId:SOURCE,revision:1,
  originalOutcome:outcome(),activeSource:null,correctionAudit:[]};
 let record=structuredClone(db);
 const grants=new Map([["editor",{actor:ACTOR,org:ORG,role:"correct-transcript"}],
   ["readonly",{actor:ACTOR,org:ORG,role:"read"}],
   ["foreign",{actor:ACTOR,org:OTHER,role:"correct-transcript"}]]);
 let queue=Promise.resolve(),mutations=0, hook=()=>{};
 function authorize(session,organizationId,need){
  const grant=grants.get(session);
  if(!grant||grant.org!==organizationId||(need&&grant.role!==need))
    throw Error("Unauthorized transcript correction access");
  return grant.actor;
 }
 const store={
  async readAuthorized({session,organizationId,sourceId}){
   authorize(session,organizationId);return sourceId===SOURCE?structuredClone(record):null;
  },
  mutateAuthorized({session,organizationId,sourceId,permission,transform}){
   const next=queue.catch(()=>{}).then(()=>{
    ++mutations;
    hook();
    const actor=authorize(session,organizationId,permission);
    const result=transform(sourceId===SOURCE?structuredClone(record):null,actor);
    // Atomic compare-and-swap & audit write, simulated ONLY in this test.
    record=structuredClone(result);
    return structuredClone(record);
   });queue=next.then(()=>{},()=>{});return next;
  },
 };
 return {store,grants,get:()=>structuredClone(record),put:x=>{record=structuredClone(x)},
  onCommit:fn=>hook=fn,mutations:()=>mutations};
}
const selector={organizationId:ORG,sourceId:SOURCE};
async function prepare(f){
 const context=await readTranscriptCorrectionContext(f.store,"editor",selector);
 const draft=prepareTranscriptCorrectionDraft(f.get().originalOutcome,corrections);
 return {...selector,expectedRevision:context.expectedRevision,
   expectedSnapshotSha256:context.expectedSnapshotSha256,
   expectedCorrectionSha256:draft.correctionSha256,decisions:corrections};
}

test("authorized atomic correction preserves original and auditable actor",async()=>{
 const f=fixture(),request=await prepare(f);
 const committed=await commitAuthorizedTranscriptCorrection(f.store,"editor",request);
 assert.equal(committed.state,"corrected-for-human-review");
 assert.equal(committed.revision,2);
 assert.equal(committed.correctedBy,ACTOR);
 const stored=f.get();
 assert.equal(stored.originalOutcome.original.text,RAW);
 assert.equal(stored.originalOutcome.original.transcriptionSucceeded,false);
 assert.equal(stored.activeSource.text,"Paint 15 units, install 40 fixtures.");
 assert.equal(stored.activeSource.transcriptionSucceeded,true);
 assert.equal(stored.correctionAudit[0].actorId,ACTOR);
 assert.equal(stored.correctionAudit[0].correctionSha256,request.expectedCorrectionSha256);
 assert.equal(stored.correctionAudit[0].sourceRevision,2);
 assert.equal(stored.correctionAudit[0].changes.length,2);
 assert.equal(prepareExtractionReview(stored.activeSource,[
  {serviceCode:"paint",units:15,start:0,end:5,excerpt:"Paint"}]).state,"needs-human-review");
 assert.equal(Object.hasOwn(committed,"send"),false);
});
test("stale approval cannot be replayed after successful commit",async()=>{
 const f=fixture(),input=await prepare(f);
 await commitAuthorizedTranscriptCorrection(f.store,"editor",input);
 await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"editor",input),/Stale/);
 assert.equal(f.get().correctionAudit.length,1);
});
test("simultaneous same-head commits produce one audit and one success",async()=>{
 const f=fixture(),input=await prepare(f);
 const result=await Promise.allSettled([
  commitAuthorizedTranscriptCorrection(f.store,"editor",input),
  commitAuthorizedTranscriptCorrection(f.store,"editor",input)]);
 assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(result.filter(x=>x.status==="rejected").length,1);
 assert.equal(f.get().correctionAudit.length,1);
});
test("revoked reviewer before queued transaction cannot commit",async()=>{
 const f=fixture(),input=await prepare(f);
 f.onCommit(()=>f.grants.delete("editor"));
 await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"editor",input),/Unauthorized/);
 assert.equal(f.get().revision,1);
 assert.equal(f.get().activeSource,null);
});
test("read-only and cross-tenant sessions cannot correct or read foreign source",async()=>{
 const f=fixture(),input=await prepare(f);
 await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"readonly",input),/Unauthorized/);
 await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"foreign",input),/Unauthorized/);
 await assert.rejects(readTranscriptCorrectionContext(f.store,"foreign",selector),/Unauthorized/);
 assert.equal(f.get().revision,1);
});
test("tampering with source, reviewer proposal or stored provider text fails closed",async()=>{
 for(const mutate of [
  (f,request)=>{request.expectedCorrectionSha256="b".repeat(64)},
  (f,request)=>{request.decisions[0].replacement="5000"},
  (f,request)=>{f.put({...f.get(),revision:2})},
  (f,request)=>{let c=f.get();c.originalOutcome.original.text+=" ";f.put(c)},
  (f,request)=>{let c=f.get();c.originalOutcome.providerVersion="2";f.put(c)},
  (f,request)=>{request.expectedSnapshotSha256="f".repeat(64)},
 ]){
  const f=fixture(),input=await prepare(f);input.decisions=structuredClone(input.decisions);
  mutate(f,input);
  await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"editor",input),/Stale|draft changed/);
  assert.equal(f.get().correctionAudit.length,0);
 }
});
test("unknown approval/send directives, forged identities and malformed selectors rejected",async()=>{
 const f=fixture(),base=await prepare(f);
 for(const bad of [
  {...base,send:true},{...base,approved:true},{...base,actorId:ACTOR},
  {...base,sourceId:"../other"},{...base,organizationId:OTHER},
  {...base,expectedRevision:0},{...base,expectedSnapshotSha256:"wrong"},
 ]){
  await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"editor",bad),
    /Invalid|Unauthorized|missing or invalid/);
 }
 assert.equal(f.mutations(),1); // foreign-company selector reaches ACL, others are rejected first.
 assert.equal(f.get().revision,1);
});
test("missing record, completed correction and failed transcription cannot be corrected",async()=>{
 const f=fixture(),input=await prepare(f);
 await assert.rejects(readTranscriptCorrectionContext(f.store,"editor",{...selector,sourceId:"22222222-2222-4222-8222-222222222222"}),/missing/);
 let rec=f.get();rec.originalOutcome={state:"failed",audioSha256:"a".repeat(64),reason:"unintelligible"};f.put(rec);
 await assert.rejects(readTranscriptCorrectionContext(f.store,"editor",selector),/Only a bounded/);
 await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"editor",input),/Stale/);
 const g=fixture();const req=await prepare(g);
 await commitAuthorizedTranscriptCorrection(g.store,"editor",req);
 await assert.rejects(readTranscriptCorrectionContext(g.store,"editor",selector),/already been committed/);
});
test("persistence that returns success without committing is rejected",async()=>{
 const f=fixture(),input=await prepare(f);
 const dishonest={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized({transform}){const result=transform(f.get(),ACTOR);return {...result,revision:1}}};
 await assert.rejects(commitAuthorizedTranscriptCorrection(dishonest,"editor",input),/did not confirm commit/);
 assert.equal(f.get().revision,1);
});
test("server-derived actor identity fails closed if absent or invalid",async()=>{
 const f=fixture(),input=await prepare(f);
 f.grants.get("editor").actor="user-from-browser";
 await assert.rejects(commitAuthorizedTranscriptCorrection(f.store,"editor",input),/Authenticated reviewer/);
 assert.equal(f.get().revision,1);
});

test("fabricated success response with correct fields but no database write is rejected",async()=>{
 const f=fixture(),input=await prepare(f);
 const liar={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized({transform}){return transform(f.get(),ACTOR);}};
 await assert.rejects(commitAuthorizedTranscriptCorrection(liar,"editor",input),/read-back does not match/);
 assert.equal(f.get().revision,1);
 assert.equal(f.get().activeSource,null);
});
test("backend cannot return a different reviewer or modified audit as success",async()=>{
 const f=fixture(),input=await prepare(f);
 const forged={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized({transform}){const result=transform(f.get(),ACTOR);
   return {...result,correctionAudit:[{...result.correctionAudit[0],actorId:OTHER}]};}};
 await assert.rejects(commitAuthorizedTranscriptCorrection(forged,"editor",input),/did not confirm commit/);
 assert.equal(f.get().correctionAudit.length,0);
});
test("committed data altered before authorized read-back is never confirmed",async()=>{
 const f=fixture(),input=await prepare(f);
 const store={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized(args){const result=await f.store.mutateAuthorized(args);
   const changed=f.get();changed.activeSource.text="changed by another writer";f.put(changed);
   return result;}};
 await assert.rejects(commitAuthorizedTranscriptCorrection(store,"editor",input),/read-back does not match/);
});
test("permission revocation after write but before read-back prevents confirmation",async()=>{
 const f=fixture(),input=await prepare(f);
 const store={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized(args){const result=await f.store.mutateAuthorized(args);
   f.grants.delete("editor");return result;}};
 await assert.rejects(commitAuthorizedTranscriptCorrection(store,"editor",input),/Unauthorized/);
 assert.equal(f.get().correctionAudit.length,1); // Durable commit may have happened.
});

test("in-place mutation of callback output cannot rewrite expected persisted audit",async()=>{
 const f=fixture(),input=await prepare(f);
 const store={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized({transform}){
   const result=transform(f.get(),ACTOR);
   result.correctionAudit[0].actorId=OTHER;
   f.put(result);
   return result;
  }};
 await assert.rejects(commitAuthorizedTranscriptCorrection(store,"editor",input),/did not confirm commit/);
 assert.equal(f.get().correctionAudit[0].actorId,OTHER);
});
