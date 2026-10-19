import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {readExtractionCorrectionContext} from "../lib/tenant-extraction-correction.ts";
import {createTrustedPostgresCorrectionPreflightStore}
  from "../lib/trusted-postgres-correction-preflight.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  SOURCE="11111111-1111-4111-8111-111111111111",
  OTHER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  REQUEST="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const text="Paint two rooms";
const original={kind:"typed-note",text};
const review=prepareExtractionReview(original,[{
  serviceCode:"painting",units:2,start:0,end:text.length,excerpt:text,
}]);
const sha=createHash("sha256").update(text).digest("hex");
function record(revision=2){
 return {
  organizationId:ORG,sourceId:SOURCE,revision,original,
  review:revision===1?null:review,
  extractionAudit:revision===1?[]:[{
    sourceRevision:2,actorId:ACTOR,
    sourceSha256:review.sourceSha256,candidatesSha256:review.candidatesSha256,
  }],
  scopeReview:null,
  creationAudit:{actorId:ACTOR,requestId:REQUEST,textSha256:sha},
 };
}
const fixture=(initial=record())=>{
 let copy=structuredClone(initial),identity=ACTOR,valid=true,reads=0,transforms=0;
 const auth={async verifyActiveSession(session){
   if(session!=="session"||!valid)throw Error("Session revoked");
   return {userId:identity};
 }};
 const db={async query(sql,params){
   reads++;
   assert.match(sql,/^select record from bm_intake_private\.read_typed_note_for_extraction/);
   assert.deepEqual(params,[ORG,ACTOR,SOURCE]);
   return {rows:[{record:structuredClone(copy)}]};
 }};
 const store=createTrustedPostgresCorrectionPreflightStore(auth,db);
 return {store,auth,db,mutate:fn=>copy=fn(structuredClone(copy)),
   changeIdentity:()=>identity=OTHER,revoke:()=>valid=false,
   get counts(){return {reads,transforms}},get original(){return copy}};
};

test("real SQL read contract prepares original typed-note correction without writing",async()=>{
 const f=fixture(),target={organizationId:ORG,sourceId:SOURCE};
 const context=await readExtractionCorrectionContext(f.store,"session",target);
 assert.equal(context.state,"requires-human-extraction-correction");
 assert.equal(context.expectedRevision,2);
 assert.match(context.expectedSnapshotSha256,/^[a-f0-9]{64}$/);
 assert.equal(f.counts.reads,2);
 assert.deepEqual(f.original,record());
});
test("unextracted source is not eligible for correction",async()=>{
 const f=fixture(record(1));
 assert.equal(await f.store.readAuthorized({
  session:"session",organizationId:ORG,sourceId:SOURCE}),null);
 await assert.rejects(readExtractionCorrectionContext(f.store,"session",{
  organizationId:ORG,sourceId:SOURCE}),/unavailable/);
});
test("correction preflight does not execute any submitted transform or SQL write",async()=>{
 const f=fixture();let invoked=0;
 await assert.rejects(f.store.mutateAuthorized({
  session:"session",organizationId:ORG,sourceId:SOURCE,
  permission:"correct-extraction",transform(){
   invoked++;throw Error("MUST NOT EXECUTE");
  },
 }),/persistence unavailable/);
 assert.equal(invoked,0);
 assert.equal(f.counts.reads,0);
});
test("session revocation and changed identity deny read results",async()=>{
 const f=fixture();
 f.revoke();
 await assert.rejects(f.store.readAuthorized({
  session:"session",organizationId:ORG,sourceId:SOURCE}),/revoked/);
 assert.equal(f.counts.reads,0);
 const g=fixture();
 const dbQuery=g.db.query.bind(g.db);
 g.db.query=async (...args)=>{
  const value=await dbQuery(...args);
  g.changeIdentity();
  return value;
 };
 await assert.rejects(g.store.readAuthorized({
  session:"session",organizationId:ORG,sourceId:SOURCE}),/changed during read/);
});
test("reject stale/forged source, unsafe fields and extra lifecycle columns",async()=>{
 for(const change of [
  row=>{row.creationAudit.actorId=OTHER;},
  row=>{row.creationAudit.textSha256="f".repeat(64);},
  row=>{row.original.text+=" forged";},
  row=>{row.review.candidates[0].units=42;},
  row=>{row.extractionAudit[0].actorId=OTHER;},
  row=>{row.pendingCorrection={state:"injected"};},
  row=>{row.scopeReview={approved:true};},
  row=>{row.organizationId=OTHER;},
 ]){
  const f=fixture();f.mutate(change);
  await assert.rejects(f.store.readAuthorized({
   session:"session",organizationId:ORG,sourceId:SOURCE}));
 }
});
test("strict selectors reject hidden fields and accessors before authentication",async()=>{
 const f=fixture(),selector={session:"session",organizationId:ORG,sourceId:SOURCE};
 const hidden={...selector};Object.defineProperty(hidden,"actorId",{value:ACTOR});
 const getter={...selector};let hits=0;
 Object.defineProperty(getter,"sourceId",{enumerable:true,get(){hits++;return SOURCE}});
 for(const invalid of [hidden,getter]){
  await assert.rejects(f.store.readAuthorized(invalid));
 }
 assert.equal(hits,0);
 assert.equal(f.counts.reads,0);
});
