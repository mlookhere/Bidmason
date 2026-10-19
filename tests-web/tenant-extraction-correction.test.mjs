import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview } from "../lib/intake-review.ts";
import { prepareExtractionCorrectionDraft } from "../lib/extraction-correction-draft.ts";
import { readExtractionCorrectionContext, commitAuthorizedExtractionCorrection }
  from "../lib/tenant-extraction-correction.ts";

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
