import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview } from "../lib/intake-review.ts";
import { prepareExtractionCorrectionDraft } from "../lib/extraction-correction-draft.ts";
import { readExtractionCorrectionContext, commitAuthorizedExtractionCorrection,
  reconcileExtractionCorrection } from "../lib/tenant-extraction-correction.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE="11111111-1111-4111-8111-111111111111";
const WRITER="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const original={kind:"typed-note",text:"Clean 2 rooms; polish floors"};
const first={serviceCode:"rooms",units:2,start:0,end:13,excerpt:"Clean 2 rooms"};
const second={serviceCode:"floor",units:1,start:15,end:28,excerpt:"polish floors"};
const change={action:"replace",index:0,candidate:{...first,units:3},
  reason:"Operator checked the quantity against the source"};

function fixture(reviewed=false){
 const review=prepareExtractionReview(original,[first,second]);
 const scopeReview=reviewed?{state:"reviewed-for-proposal-draft",sourceRevision:3,
   reviewedBy:WRITER,reviewKey:"a".repeat(64),sourceSha256:review.sourceSha256,
   candidatesSha256:review.candidatesSha256,selectedIndices:[0],
   acceptedAddonCodes:[],policyRevision:1,policySha256:"b".repeat(64),
   reviewedSelectionSha256:"c".repeat(64)}:null;
 let row={organizationId:ORG,sourceId:SOURCE,revision:reviewed?3:2,
   original:structuredClone(original),review:structuredClone(review),
   extractionAudit:[{sourceRevision:2,actorId:WRITER,
     sourceSha256:review.sourceSha256,candidatesSha256:review.candidatesSha256}],
   scopeReview,pendingCorrection:null};
 let queue=Promise.resolve(),writes=0,reads=0;
 let afterWrite=()=>{},beforeWrite=()=>{},beforeRead=()=>{};
 const permissions=new Map([["reviewer",{org:ORG,write:true}],
   ["viewer",{org:ORG,write:false}],["foreign",{org:OTHER,write:true}]]);
 const authenticate=(session,org,write=false)=>{
  const grant=permissions.get(session);
  if(!grant || grant.org!==org || (write&&!grant.write))throw Error("Unauthorized correct-extraction");
  return WRITER;
 };
 const store={
  async readAuthorized({session,organizationId,sourceId}){
   ++reads;beforeRead();authenticate(session,organizationId);
   return sourceId===SOURCE?structuredClone(row):null;
  },
  mutateAuthorized({session,organizationId,sourceId,permission,transform}){
   const work=queue.catch(()=>{}).then(()=>{
    ++writes;beforeWrite();
    if(permission!=="correct-extraction")throw Error("Unauthorized correction permission");
    const actor=authenticate(session,organizationId,true);
    const next=transform(sourceId===SOURCE?structuredClone(row):null,actor);
    row=structuredClone(next);afterWrite();
    return structuredClone(next);
   }); queue=work.then(()=>{},()=>{}); return work;
  },
 };
 return {store,permissions,get:()=>structuredClone(row),
  hooks:{setBeforeWrite:x=>beforeWrite=x,setAfterWrite:x=>afterWrite=x,
    setBeforeRead:x=>beforeRead=x},
  counts:()=>({writes,reads})};
}
const selector={organizationId:ORG,sourceId:SOURCE};
async function request(f,changes=[change]){
 const ctx=await readExtractionCorrectionContext(f.store,"reviewer",selector);
 const row=f.get();
 const draft=prepareExtractionCorrectionDraft(row.original,row.review,changes);
 return {...selector,expectedRevision:ctx.expectedRevision,
   expectedSnapshotSha256:ctx.expectedSnapshotSha256,
   expectedCorrectionSha256:draft.correctionSha256,changes};
}
test("atomic human correction preserves original extraction and stores pending audit only",async()=>{
 const f=fixture(),prior=f.get(),req=await request(f);
 const value=await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 assert.equal(value.state,"correction-committed-pending-activation");
 assert.equal(value.revision,3);
 assert.equal(value.correctedBy,WRITER);
 const stored=f.get();
 assert.deepEqual(stored.original,prior.original);
 assert.deepEqual(stored.review,prior.review);
 assert.deepEqual(stored.extractionAudit,prior.extractionAudit);
 assert.equal(stored.scopeReview,null);
 assert.equal(stored.pendingCorrection.state,"pending-authorized-activation");
 assert.equal(stored.pendingCorrection.correctedBy,WRITER);
 assert.equal(stored.pendingCorrection.proposedCandidates[0].units,3);
 assert.equal(stored.pendingCorrection.changes[0].before.units,2);
 assert.equal(Object.hasOwn(value,"approved"),false);
 assert.equal(Object.hasOwn(value,"send"),false);
 assert.equal(f.counts().writes,1);
});
test("reviewed scope is invalidated and retained inside pending correction audit",async()=>{
 const f=fixture(true),before=f.get(),req=await request(f);
 const value=await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 assert.equal(value.revision,4);
 const stored=f.get();
 assert.equal(stored.scopeReview,null);
 assert.deepEqual(stored.pendingCorrection.invalidatedScopeReview,before.scopeReview);
 assert.equal(stored.pendingCorrection.sourceRevision,4);
});
test("concurrent duplicate corrections can commit at most once",async()=>{
 const f=fixture(),req=await request(f);
 const results=await Promise.allSettled([
  commitAuthorizedExtractionCorrection(f.store,"reviewer",req),
  commitAuthorizedExtractionCorrection(f.store,"reviewer",req),
 ]);
 assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(results.filter(x=>x.status==="rejected").length,1);
 assert.equal(f.get().revision,3);
 assert.equal(f.counts().writes,2);
});
test("revoked, cross-tenant and view-only sessions cannot correct records",async()=>{
 const f=fixture(),req=await request(f);
 for(const session of ["foreign","viewer"]){
  await assert.rejects(commitAuthorizedExtractionCorrection(f.store,session,req),
   /Unauthorized/);
 }
 f.permissions.delete("reviewer");
 await assert.rejects(commitAuthorizedExtractionCorrection(f.store,"reviewer",req),/Unauthorized/);
 assert.equal(f.get().pendingCorrection,null);
});
test("stale revisions, altered source or tampered correction digests deny writes",async()=>{
 const f=fixture(),req=await request(f);
 for(const invalid of [{...req,expectedRevision:1},
   {...req,expectedSnapshotSha256:"0".repeat(64)},
   {...req,expectedCorrectionSha256:"0".repeat(64)},
   {...req,changes:[{...change,approved:true}]}]){
  await assert.rejects(commitAuthorizedExtractionCorrection(f.store,"reviewer",invalid));
 }
 assert.equal(f.get().pendingCorrection,null);
});
test("false write acknowledgements, bad readback and revoked readback never confirm",async()=>{
 for(const mode of ["fake","tamper","revoke"]){
  const f=fixture(),req=await request(f),oldRead=f.store.readAuthorized;
  if(mode==="fake"){
   f.store.mutateAuthorized=async opts=>opts.transform(f.get(),WRITER);
  }else if(mode==="tamper"){
   f.hooks.setAfterWrite(()=>{const next=f.get();next.pendingCorrection.correctedBy=OTHER;
    f.hooks.setBeforeRead(()=>{});f.store.readAuthorized=async args=>{
      const s=await oldRead(args);return {...s,pendingCorrection:next.pendingCorrection};
    };});
  }else{
   f.hooks.setAfterWrite(()=>f.permissions.delete("reviewer"));
  }
  await assert.rejects(commitAuthorizedExtractionCorrection(f.store,"reviewer",req));
  if(mode==="fake")assert.equal(f.get().pendingCorrection,null);
 }
});
test("repeated prep on pending correction is denied",async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 await assert.rejects(readExtractionCorrectionContext(f.store,"reviewer",selector),
  /unavailable/);
});

test("reconciliation distinguishes a verified unchanged primary record from a pending commit",async()=>{
 const f=fixture(),req=await request(f);
 const unchanged=await reconcileExtractionCorrection(f.store,"reviewer",req);
 assert.deepEqual(unchanged,{state:"unchanged-at-read",sourceId:SOURCE});
 assert.equal(f.counts().writes,0);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 const recorded=await reconcileExtractionCorrection(f.store,"reviewer",req);
 assert.equal(recorded.state,"recorded-pending-at-read");
 assert.equal(recorded.revision,3);
 assert.equal(recorded.correctedBy,WRITER);
 assert.equal(recorded.correctionSha256,req.expectedCorrectionSha256);
 assert.equal(Object.hasOwn(recorded,"approved"),false);
 assert.equal(Object.hasOwn(recorded,"activated"),false);
 assert.equal(f.counts().writes,1);
});

test("recorded correction reconciles invalidated scope without restoring it",async()=>{
 const f=fixture(true),before=f.get(),req=await request(f);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 const found=await reconcileExtractionCorrection(f.store,"reviewer",req);
 assert.equal(found.state,"recorded-pending-at-read");
 assert.equal(found.revision,4);
 assert.equal(f.get().scopeReview,null);
 assert.deepEqual(f.get().pendingCorrection.invalidatedScopeReview,before.scopeReview);
});

test("tampered proposed data, history and correction metadata classify as conflict",async()=>{
 const mutations=[
  value=>{value.pendingCorrection.proposedCandidates[0].units=99;},
  value=>{value.pendingCorrection.changes[0].reason="fabricated";},
  value=>{value.pendingCorrection.correctedBy=OTHER;},
  value=>{value.pendingCorrection.invalidatedScopeReview={approved:true};},
  value=>{value.review.candidates[0].units=14;},
  value=>{value.original.text+=" forged";},
  value=>{value.pendingCorrection.approved=true;},
  value=>{value.revision++;},
  value=>{value.scopeReview={approved:true};},
 ];
 for(const changeStored of mutations){
  const f=fixture(),req=await request(f);
  await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
  const actual=f.store.readAuthorized;
  f.store.readAuthorized=async args=>{
   const value=await actual(args);changeStored(value);return value;
  };
  const out=await reconcileExtractionCorrection(f.store,"reviewer",req);
  assert.equal(out.state,"conflict");
 }
});

test("stale request digest and decisions cannot reconcile a different commit",async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 for(const changed of [
  {...req,expectedSnapshotSha256:"0".repeat(64)},
  {...req,expectedCorrectionSha256:"a".repeat(64)},
  {...req,changes:[{...change,candidate:{...first,units:4}}]},
  {...req,expectedRevision:req.expectedRevision+1},
 ]) {
  const out=await reconcileExtractionCorrection(f.store,"reviewer",changed);
  assert.equal(out.state,"conflict");
 }
});

test("read reconciliation never retries and notices between-read changes",async()=>{
 const f=fixture(),req=await request(f);
 const rawRead=f.store.readAuthorized;
 let calls=0;
 f.store.readAuthorized=async args=>{
  const current=await rawRead(args);
  if(++calls===2){
   return {...current,revision:current.revision+1};
  }
  return current;
 };
 const out=await reconcileExtractionCorrection(f.store,"reviewer",req);
 assert.equal(out.state,"conflict");
 assert.equal(f.counts().writes,0);
});

test("authorization loss, cross-tenant denial and record disappearance do not imply rollback",async()=>{
 const f=fixture(),req=await request(f);
 await assert.rejects(reconcileExtractionCorrection(f.store,"foreign",req),/Unauthorized/);
 f.permissions.delete("reviewer");
 await assert.rejects(reconcileExtractionCorrection(f.store,"reviewer",req),/Unauthorized/);
 const another=fixture(),read=another.store.readAuthorized;
 let calls=0;
 another.store.readAuthorized=async args=>{
  const row=await read(args);
  return ++calls===2?null:row;
 };
 const otherReq=await request(another);
 // request() runs two reads, reset the count for the recovery case.
 calls=0;
 await assert.rejects(reconcileExtractionCorrection(another.store,"reviewer",otherReq),
  /unavailable/);
});

test("reconciliation rejects hidden authority and malformed correction request getters",async()=>{
 const f=fixture(),req=await request(f);
 let reads=0;
 const accessor={...req};
 Object.defineProperty(accessor,"expectedRevision",{enumerable:true,get(){reads++;return 2;}});
 const hidden={...req};
 Object.defineProperty(hidden,"send",{value:true});
 const symbolic={...req,[Symbol("approved")]:true};
 for(const malformed of [accessor,hidden,symbolic]){
  await assert.rejects(reconcileExtractionCorrection(f.store,"reviewer",malformed),
   /Invalid extraction correction request/);
 }
 assert.equal(reads,0);
 assert.equal(f.counts().writes,0);
});
