import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview } from "../lib/intake-review.ts";
import { prepareExtractionCorrectionDraft } from "../lib/extraction-correction-draft.ts";
import { readExtractionCorrectionContext, commitAuthorizedExtractionCorrection,
  reconcileExtractionCorrection, readExtractionActivationContext,
  commitAuthorizedExtractionActivation } from "../lib/tenant-extraction-correction.ts";

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
    if(!["correct-extraction","activate-extraction-correction"].includes(permission))
     throw Error("Unauthorized correction permission");
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
  value=>{value.pendingCorrection.correctedBy="not-an-authenticated-uuid";},
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
 const another=fixture();
 const otherReq=await request(another);
 const read=another.store.readAuthorized;
 let calls=0;
 another.store.readAuthorized=async args=>{
  const row=await read(args);
  return ++calls===2?null:row;
 };
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

test("matching pending evidence cannot independently prove historic actor authorization",async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 // A syntactically valid actor ID from storage is an observed assertion,
 // not proof of the original correct-extraction grant. The trusted writer
 // and append-only audit must establish that separately.
 const read=f.store.readAuthorized;
 f.store.readAuthorized=async opts=>{
  const row=await read(opts);
  return {...row,pendingCorrection:{...row.pendingCorrection,correctedBy:OTHER}};
 };
 const out=await reconcileExtractionCorrection(f.store,"reviewer",req);
 assert.equal(out.state,"recorded-pending-at-read");
 assert.equal(out.correctedBy,OTHER);
 assert.equal(Object.hasOwn(out,"approved"),false);
});

async function pendingActivation(f) {
 const req=await request(f);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 const context=await readExtractionActivationContext(f.store,"reviewer",selector);
 return { ...selector, expectedRevision:context.expectedRevision,
  expectedSnapshotSha256:context.expectedSnapshotSha256,
  expectedCorrectionSha256:context.expectedCorrectionSha256 };
}

test("explicit authorized activation retains provider lineage and needs new human scope",async()=>{
 const f=fixture(true),originalRow=f.get();
 const activation=await pendingActivation(f);
 const before=f.get();
 const result=await commitAuthorizedExtractionActivation(f.store,"reviewer",activation);
 assert.equal(result.state,"activated-for-renewed-human-scope-review");
 assert.equal(result.revision,5);
 assert.equal(result.activatedBy,WRITER);
 assert.match(result.activationSha256,/^[a-f0-9]{64}$/);
 const row=f.get();
 assert.deepEqual(row.original,originalRow.original);
 assert.deepEqual(row.review,originalRow.review);
 assert.deepEqual(row.extractionAudit,originalRow.extractionAudit);
 assert.equal(row.scopeReview,null);
 assert.equal(row.pendingCorrection,null);
 assert.equal(row.activatedCorrection.state,"awaiting-renewed-human-scope-review");
 assert.equal(row.activatedCorrection.correctedReview.candidates[0].units,3);
 assert.deepEqual(row.activatedCorrection.priorCorrection,before.pendingCorrection);
 assert.deepEqual(row.activatedCorrection.priorCorrection.invalidatedScopeReview,
  originalRow.scopeReview);
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
});

test("activation is one-time, CAS-bound, and does not silently reapply corrections",async()=>{
 const f=fixture(),activation=await pendingActivation(f);
 const outcomes=await Promise.allSettled([
  commitAuthorizedExtractionActivation(f.store,"reviewer",activation),
  commitAuthorizedExtractionActivation(f.store,"reviewer",activation),
 ]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
 assert.equal(f.get().revision,4);
 await assert.rejects(readExtractionActivationContext(f.store,"reviewer",selector));
 await assert.rejects(readExtractionCorrectionContext(f.store,"reviewer",selector));
});

test("revoked, foreign, view-only and invalid activation digests cannot write",async()=>{
 const f=fixture(),activation=await pendingActivation(f),baseline=f.get();
 for(const session of ["viewer","foreign"]){
  await assert.rejects(commitAuthorizedExtractionActivation(f.store,session,activation),
   /Unauthorized/);
 }
 for(const input of [
  {...activation,expectedRevision:activation.expectedRevision+1},
  {...activation,expectedSnapshotSha256:"0".repeat(64)},
  {...activation,expectedCorrectionSha256:"0".repeat(64)},
  {...activation,actorId:WRITER},
  {...activation,approved:true},
 ])await assert.rejects(commitAuthorizedExtractionActivation(f.store,"reviewer",input));
 assert.deepEqual(f.get(),baseline);
 f.permissions.delete("reviewer");
 await assert.rejects(commitAuthorizedExtractionActivation(f.store,"reviewer",activation),
  /Unauthorized/);
 assert.deepEqual(f.get(),baseline);
});

test("tampered pending lineage and false write acknowledgements fail closed",async()=>{
 const f=fixture(),request=await pendingActivation(f);
 const originalRead=f.store.readAuthorized;
 f.store.readAuthorized=async opts=>{
  const row=await originalRead(opts);
  row.pendingCorrection.changes[0].after.units=99;
  return row;
 };
 await assert.rejects(readExtractionActivationContext(f.store,"reviewer",selector));
 // Locked transaction must reject even if a previously read client digest was valid.
 const second=fixture(),req=await pendingActivation(second),read=second.store.readAuthorized;
 second.store.mutateAuthorized=async opts=>opts.transform(second.get(),WRITER);
 await assert.rejects(commitAuthorizedExtractionActivation(second.store,"reviewer",req),
  /not confirmed/);
 const third=fixture(),thirdReq=await pendingActivation(third);
 third.hooks.setAfterWrite(()=>third.permissions.delete("reviewer"));
 await assert.rejects(commitAuthorizedExtractionActivation(third.store,"reviewer",thirdReq),
  /Unauthorized/);
});


test("correction decisions remain fixed before deferred CAS despite caller mutation",async()=>{
 const f=fixture(),req=await request(f);
 f.hooks.setBeforeWrite(()=>{
  req.organizationId=OTHER;
  req.sourceId="22222222-2222-4222-8222-222222222222";
  req.expectedRevision=77;
  req.expectedSnapshotSha256="0".repeat(64);
  req.expectedCorrectionSha256="f".repeat(64);
  req.changes[0].candidate.units=4;
  req.changes[0].reason="changed after submission";
  req.changes.push({action:"remove",index:1,reason:"forged extra change"});
 });
 const result=await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 assert.equal(result.state,"correction-committed-pending-activation");
 assert.equal(result.sourceId,SOURCE);
 assert.equal(result.revision,3);
 assert.equal(f.get().pendingCorrection.proposedCandidates[0].units,3);
 assert.equal(f.get().pendingCorrection.changes.length,1);
 assert.equal(f.get().pendingCorrection.changes[0].reason,change.reason);
 assert.equal(f.get().pendingCorrection.changes[0].after.units,3);
 assert.equal(f.get().scopeReview,null);
});

test("read-only pending correction recovery holds submitted actions across both reads",async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedExtractionCorrection(f.store,"reviewer",req);
 let inspected=0;
 f.hooks.setBeforeRead(()=>{
  if(++inspected===1){
   req.organizationId=OTHER;
   req.expectedRevision=99;
   req.expectedSnapshotSha256="0".repeat(64);
   req.expectedCorrectionSha256="f".repeat(64);
   req.changes[0].candidate.units=5;
   req.changes[0].reason="changed mid-recovery";
  }
 });
 const result=await reconcileExtractionCorrection(f.store,"reviewer",req);
 assert.equal(result.state,"recorded-pending-at-read");
 assert.equal(result.sourceId,SOURCE);
 assert.equal(result.revision,3);
 assert.equal(f.counts().writes,1);
 assert.equal(inspected,2);
});

test("activation transaction retains original digest and source after deferred write",async()=>{
 const f=fixture(),req=await pendingActivation(f);
 f.hooks.setBeforeWrite(()=>{
  req.organizationId=OTHER;
  req.sourceId="22222222-2222-4222-8222-222222222222";
  req.expectedRevision=100;
  req.expectedSnapshotSha256="0".repeat(64);
  req.expectedCorrectionSha256="f".repeat(64);
 });
 const result=await commitAuthorizedExtractionActivation(f.store,"reviewer",req);
 assert.equal(result.state,"activated-for-renewed-human-scope-review");
 assert.equal(result.sourceId,SOURCE);
 assert.equal(result.revision,4);
 assert.equal(f.get().scopeReview,null);
 assert.equal(f.get().pendingCorrection,null);
 assert.equal(f.get().activatedCorrection.correctedReview.candidates[0].units,3);
});

test("correction and activation preparation keep original tenant across authorized reads",async()=>{
 for(const mode of ["correction","activation"]){
  const f=fixture();
  if(mode==="activation") await pendingActivation(f);
  const mutable={...selector};
  let reads=0;
  f.hooks.setBeforeRead(()=>{
   if(++reads===1){
    mutable.organizationId=OTHER;
    mutable.sourceId="22222222-2222-4222-8222-222222222222";
   }
  });
  const result=mode==="activation"
   ?await readExtractionActivationContext(f.store,"reviewer",mutable)
   :await readExtractionCorrectionContext(f.store,"reviewer",mutable);
  assert.equal(result.organizationId,ORG);
  assert.equal(result.sourceId,SOURCE);
  assert.equal(reads,2);
 }
});

test("forged correction action arrays and getters are rejected without a write",async()=>{
 const f=fixture(),req=await request(f),prior=f.counts();
 let getterInvoked=0;
 const getter={...req,changes:[change]};
 Object.defineProperty(getter.changes,"0",{enumerable:true,configurable:true,
  get(){getterInvoked++;throw Error("index getter executed");}});
 const nestedGetter={...req,changes:[{...change,candidate:{...change.candidate}}]};
 Object.defineProperty(nestedGetter.changes[0].candidate,"units",{
  enumerable:true,get(){getterInvoked++;throw Error("candidate getter executed");}});
 const sparse={...req,changes:new Array(1)};
 const decorated={...req,changes:[change]};
 Object.defineProperty(decorated.changes,"approved",{value:true});
 const hidden={...req,changes:[{...change}]};
 Object.defineProperty(hidden.changes[0],"send",{value:true});
 const symbolic={...req,changes:[{...change}]};
 symbolic.changes[0][Symbol("approved")]=true;
 const inherited={...req,changes:[Object.assign(Object.create({approved:true}),change)]};
 for(const invalid of [getter,nestedGetter,sparse,decorated,hidden,symbolic,inherited]){
  await assert.rejects(commitAuthorizedExtractionCorrection(
   f.store,"reviewer",invalid),/Invalid extraction correction/);
 }
 assert.equal(getterInvoked,0);
 assert.deepEqual(f.counts(),prior);
 assert.equal(f.get().pendingCorrection,null);
});

test("extraction preparation rejects hidden and accessor selectors before store reads",async()=>{
 const f=fixture(),before=f.counts(),hidden={...selector};
 Object.defineProperty(hidden,"send",{value:true});
 const accessor={...selector};let calls=0;
 Object.defineProperty(accessor,"sourceId",{enumerable:true,
  get(){calls++;throw Error("unsafe selector getter");}});
 for(const bad of [hidden,accessor]){
  await assert.rejects(readExtractionCorrectionContext(f.store,"reviewer",bad),
   /Invalid extraction correction selector/);
  await assert.rejects(readExtractionActivationContext(f.store,"reviewer",bad),
   /Invalid extraction correction selector/);
 }
 assert.equal(calls,0);
 assert.deepEqual(f.counts(),before);
});
