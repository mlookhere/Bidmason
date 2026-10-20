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
test("preflight snapshots tenant/source/session during asynchronous Auth",async()=>{
 const f=fixture(),originalVerify=f.auth.verifyActiveSession.bind(f.auth);
 const input={session:"session",organizationId:ORG,sourceId:SOURCE};
 let calls=0;
 f.auth.verifyActiveSession=async session=>{
  if(++calls===1){
   input.organizationId=OTHER; input.sourceId=OTHER;
   input.session="forged-session";
  }
  return originalVerify(session);
 };
 const record=await f.store.readAuthorized(input);
 assert.equal(record.organizationId,ORG);
 assert.equal(record.sourceId,SOURCE);
 assert.equal(calls,2);
 assert.equal(f.counts.reads,1);
});
test("preflight snapshots tenant/source/session during an asynchronous SQL query",async()=>{
 const f=fixture(),originalQuery=f.db.query.bind(f.db);
 const input={session:"session",organizationId:ORG,sourceId:SOURCE};
 let calls=0;
 f.db.query=async (...args)=>{
  calls++;
  input.organizationId=OTHER; input.sourceId=OTHER;
  input.session="forged-session";
  return originalQuery(...args);
 };
 const record=await f.store.readAuthorized(input);
 assert.equal(record.organizationId,ORG);
 assert.equal(record.sourceId,SOURCE);
 assert.equal(calls,1);
});
test("nested source and audit accessor fields are never evaluated",async()=>{
 for(const part of ["original","creationAudit"]){
  const f=fixture(),query=f.db.query.bind(f.db);
  let accessorCalls=0;
  f.db.query=async (...args)=>{
   const response=await query(...args);
   const payload=response.rows[0].record;
   const nested={...payload[part]};
   const key=part==="original"?"text":"requestId";
   Object.defineProperty(nested,key,{enumerable:true,
    get(){accessorCalls++;return part==="original"?text:REQUEST;}});
   payload[part]=nested;
   return response;
  };
  await assert.rejects(f.store.readAuthorized({
   session:"session",organizationId:ORG,sourceId:SOURCE,
  }),/Untrusted correction source projection/);
  assert.equal(accessorCalls,0);
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


test("rejects forged SQL row arrays without invoking getters or permitting correction writes",async()=>{
  let invoked=0;
  const poison=[
    rows=>Object.defineProperty(rows,"0",{enumerable:true,
      get(){invoked++;throw Error("unsafe SQL index getter");}}),
    rows=>{delete rows[0];},
    rows=>Object.defineProperty(rows,"0",{enumerable:false,
      configurable:true,writable:true,value:rows[0]}),
    rows=>{rows[Symbol("approved")]=true;},
    rows=>Object.defineProperty(rows,"send",{value:true}),
    rows=>Object.setPrototypeOf(rows,Object.create(Array.prototype)),
  ];
  for(const corrupt of poison){
    const f=fixture(),original=f.db.query.bind(f.db);
    f.db.query=async (...args)=>{
      const result=await original(...args);
      corrupt(result.rows);
      return result;
    };
    await assert.rejects(f.store.readAuthorized({
      session:"session",organizationId:ORG,sourceId:SOURCE,
    }),/Authorized correction original is unavailable/);
    assert.equal(f.counts.reads,1);
    assert.deepEqual(f.original,record());
    await assert.rejects(f.store.mutateAuthorized({
      session:"session",organizationId:ORG,sourceId:SOURCE,
      permission:"correct-extraction",transform(){invoked++;return record();},
    }),/Correction persistence unavailable/);
  }
  assert.equal(invoked,0);
});

test("rejects forged SQL record descriptor before accessing private typed-note source",async()=>{
  let invoked=0;
  for(const corrupt of [
    row=>Object.defineProperty(row,"record",{enumerable:true,
      get(){invoked++;throw Error("unsafe private record getter");}}),
    row=>{row[Symbol("approved")]=true;},
    row=>Object.defineProperty(row,"send",{value:true}),
    row=>Object.setPrototypeOf(row,{record:{approved:true}}),
  ]){
    const f=fixture(),original=f.db.query.bind(f.db);
    f.db.query=async (...args)=>{
      const result=await original(...args);
      corrupt(result.rows[0]);
      return result;
    };
    await assert.rejects(f.store.readAuthorized({
      session:"session",organizationId:ORG,sourceId:SOURCE,
    }),/Authorized correction original is unavailable/);
    assert.equal(f.counts.reads,1);
  }
  assert.equal(invoked,0);
});

test("a primary SQL preflight never normalizes forged lifecycle columns or executes a write",async()=>{
  const f=fixture(),query=f.db.query.bind(f.db);
  let mutation=0;
  f.db.query=async(...args)=>{
    const result=await query(...args);
    result.rows[0].record.pendingCorrection={state:"injected"};
    return result;
  };
  await assert.rejects(f.store.readAuthorized({
    session:"session",organizationId:ORG,sourceId:SOURCE,
  }),/Untrusted correction source projection/);
  await assert.rejects(f.store.mutateAuthorized({
    session:"session",organizationId:ORG,sourceId:SOURCE,
    permission:"correct-extraction",transform(){mutation++;return record();},
  }),/Correction persistence unavailable/);
  assert.equal(mutation,0);
  assert.equal(f.counts.reads,1);
});
