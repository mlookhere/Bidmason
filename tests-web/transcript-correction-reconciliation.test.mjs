import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareTranscriptCorrectionDraft } from "../lib/transcript-clarification.ts";
import { reconcileTranscriptCorrection } from "../lib/transcript-correction-reconciliation.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source="11111111-1111-4111-8111-111111111111";
const actor="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const raw="Paint fifteen units, install forty fixtures.";
const result={state:"needs-information",audioSha256:"a".repeat(64),providerName:"mock",
 providerVersion:"1",durationMs:4400,original:{kind:"transcript",text:raw,transcriptionSucceeded:false},
 uncertainties:[{start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"},
  {start:29,end:34,excerpt:"forty",reason:"unclear-speech"}],segments:[]};
const decisions=[{uncertaintyIndex:0,replacement:"15",explanation:"Reviewed audio"},
 {uncertaintyIndex:1,replacement:"40",explanation:"Checked notes"}];
const draft=prepareTranscriptCorrectionDraft(result,decisions);
const original={organizationId:org,sourceId:source,revision:1,originalOutcome:result,
 activeSource:null,correctionAudit:[]};
const hash=(rec)=>createHash("sha256").update(JSON.stringify([
 rec.organizationId,rec.sourceId,rec.revision,rec.originalOutcome,rec.activeSource,rec.correctionAudit])).digest("hex");
const request={organizationId:org,sourceId:source,expectedRevision:1,
 expectedSnapshotSha256:hash(original),expectedCorrectionSha256:draft.correctionSha256,
 decisions};
const committed={...original,revision:2,
 activeSource:{kind:"transcript",text:draft.proposedSource.text,transcriptionSucceeded:true},
 correctionAudit:[{sourceRevision:2,actorId:actor,audioSha256:draft.audioSha256,
 rawTranscriptSha256:draft.rawTranscriptSha256,
 correctedTranscriptSha256:draft.proposedTranscriptSha256,
 correctionSha256:draft.correctionSha256,changes:draft.corrections}]};
const store=(record, fn)=>({readAuthorized:async ({organizationId,sourceId,session})=>{
 if(session!=="editor"||organizationId!==org||sourceId!==source)throw Error("unauthorized");
 fn?.();return structuredClone(record);
}});

test("missing write confirmation is recovered from authenticated committed audit",async()=>{
 const value=await reconcileTranscriptCorrection(store(committed),"editor",request);
 assert.deepEqual(value,{state:"confirmed",sourceId:source,revision:2,
  correctionSha256:draft.correctionSha256,correctedBy:actor});
});
test("unchanged head at read time does not assert rollback",async()=>{
 const value=await reconcileTranscriptCorrection(store(original),"editor",request);
 assert.deepEqual(value,{state:"unchanged-at-read",sourceId:source});
});
test("a replay reconciliation never writes or changes the source",async()=>{
 const rec=structuredClone(committed);let reads=0;
 const s=store(rec,()=>reads++);
 const first=await reconcileTranscriptCorrection(s,"editor",request);
 const second=await reconcileTranscriptCorrection(s,"editor",request);
 assert.deepEqual(first,second);assert.equal(reads,2);
 assert.deepEqual(rec,committed);
});
test("tampered or competing commits return conflict without accepting a send",async()=>{
 const variants=[
  {...committed,revision:3},
  {...committed,activeSource:{...committed.activeSource,text:"wrong"}},
  {...committed,correctionAudit:[{...committed.correctionAudit[0],actorId:"not-an-actor"}]},
  {...committed,correctionAudit:[{...committed.correctionAudit[0],changes:[]}]},
  {...committed,correctionAudit:[{...committed.correctionAudit[0],correctionSha256:"b".repeat(64)}]},
  {...committed,correctionAudit:[{...committed.correctionAudit[0],approved:true}]},
  {...committed,originalOutcome:{...result,providerVersion:"tampered"}},
  {...original,revision:2,activeSource:null},
  {...original,correctionAudit:[committed.correctionAudit[0]]},
 ];
 for(const v of variants){
  const status=await reconcileTranscriptCorrection(store(v),"editor",request);
  assert.deepEqual(status,{state:"conflict",sourceId:source});
 }
});
test("forged requested replacements or hashes never confirm committed records",async()=>{
 for(const req of [
  {...request,expectedCorrectionSha256:"b".repeat(64)},
  {...request,expectedSnapshotSha256:"b".repeat(64)},
  {...request,decisions:[{...decisions[0],replacement:"1500"},decisions[1]]},
 ]){
  assert.equal((await reconcileTranscriptCorrection(store(committed),"editor",req)).state,"conflict");
 }
});
test("malformed requests and approval directives rejected without storage access",async()=>{
 let calls=0;const s=store(committed,()=>calls++);
 for(const req of [
  {...request,send:true},{...request,approved:true},
  {...request,sourceId:"../other"},{...request,organizationId:"wrong"},
  {...request,expectedRevision:0},{...request,expectedSnapshotSha256:"bad"},
  {...request,decisions:"invalid"},null,
 ])await assert.rejects(reconcileTranscriptCorrection(s,"editor",req),/Invalid/);
 assert.equal(calls,0);
});
test("revoked access, missing source and malformed tenant record do not claim rollback",async()=>{
 await assert.rejects(reconcileTranscriptCorrection(store(committed),"outsider",request),/unauthorized/);
 await assert.rejects(reconcileTranscriptCorrection(store(null),"editor",request),/unavailable/);
 await assert.rejects(reconcileTranscriptCorrection(store({...committed,sourceId:"22222222-2222-4222-8222-222222222222"}),"editor",request),/unavailable/);
});
test("future unrelated version after a valid correction requires manual conflict resolution",async()=>{
 const v={...committed,revision:3};
 assert.equal((await reconcileTranscriptCorrection(store(v),"editor",request)).state,"conflict");
});


test("transcript recovery binds original tenant, digest and decisions across authorized read",async()=>{
 const changing={...request,decisions:structuredClone(request.decisions)};
 let reads=0;
 const trusted=store(committed,()=>{
  if(++reads===1){
   changing.organizationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
   changing.sourceId="22222222-2222-4222-8222-222222222222";
   changing.expectedRevision=99;
   changing.expectedSnapshotSha256="0".repeat(64);
   changing.expectedCorrectionSha256="f".repeat(64);
   changing.decisions[0].replacement="9999";
  }
 });
 const verified=await reconcileTranscriptCorrection(trusted,"editor",changing);
 assert.deepEqual(verified,{state:"confirmed",sourceId:source,revision:2,
  correctionSha256:draft.correctionSha256,correctedBy:actor});
 assert.equal(reads,1);
});

test("reconciliation denies malicious corrections and selector getters before any authorized read",async()=>{
 let reads=0,getters=0;
 const s=store(committed,()=>reads++);
 const hidden={...request};Object.defineProperty(hidden,"send",{value:true});
 const symbol={...request};symbol[Symbol("approved")]=true;
 const inherited=Object.assign(Object.create({send:true}),request);
 const indexGetter={...request,decisions:structuredClone(request.decisions)};
 Object.defineProperty(indexGetter.decisions,"0",{enumerable:true,
  get(){getters++;throw Error("unsafe index getter");}});
 const nestedGetter={...request,decisions:structuredClone(request.decisions)};
 Object.defineProperty(nestedGetter.decisions[0],"explanation",{enumerable:true,
  get(){getters++;throw Error("unsafe explanation getter");}});
 const selectorGetter={...request};
 Object.defineProperty(selectorGetter,"organizationId",{enumerable:true,
  get(){getters++;throw Error("unsafe organization getter");}});
 for(const wrong of [hidden,symbol,inherited,indexGetter,nestedGetter,selectorGetter]){
  await assert.rejects(reconcileTranscriptCorrection(s,"editor",wrong),
   /Invalid correction reconciliation request/);
 }
 assert.equal(reads,0);
 assert.equal(getters,0);
});
