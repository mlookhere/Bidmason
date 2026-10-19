import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTrustedTypedNoteExtraction }
  from "../lib/trusted-typed-note-extraction.ts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const text = "Paint 🧱 two rooms, including primer.";
const SHA = createHash("sha256").update(text).digest("hex");
const excerpt = "🧱 two rooms";
const start = text.indexOf(excerpt);
const valid = JSON.stringify({candidates:[{
  serviceCode:"painting", units:2, start, end:start+excerpt.length, excerpt,
}]});
const input = {session:"signed-in", organizationId:ORG, sourceId:SOURCE,
  rawExtractionResponse:valid};
const initial = {organizationId:ORG, sourceId:SOURCE, revision:1,
  original:{kind:"typed-note",text}, review:null, extractionAudit:[],
  scopeReview:null, creationAudit:{actorId:ACTOR,requestId:REQUEST,textSha256:SHA}};

function fixture() {
  let record=structuredClone(initial), active=true, owner=ACTOR;
  const queries=[], authCalls=[];
  const auth={async verifyActiveSession(session) {
    authCalls.push(session);
    if(!active || session!=="signed-in")throw Error("Auth session revoked");
    return {userId:owner};
  }};
  const db={async query(sql,params) {
    queries.push({sql,params});
    if(params[0]!==ORG || params[1]!==ACTOR)
      throw Error("Tenant membership or creator required");
    if(sql.includes("read_typed_note_for_extraction")) {
      return {rows:[{record:structuredClone(record)}]};
    }
    if(!sql.includes("commit_typed_note_extraction"))
      throw Error("Unexpected private operation");
    if(record.revision!==1 || record.creationAudit.textSha256!==params[3])
      throw Error("Stale extraction CAS");
    const review=JSON.parse(params[4]);
    record={...record, revision:2, review, extractionAudit:[{
      sourceRevision:2, actorId:ACTOR,
      sourceSha256:review.sourceSha256,
      candidatesSha256:review.candidatesSha256,
    }]};
    return {rows:[{source_revision:2,original_sha256:SHA,
      candidates_sha256:review.candidatesSha256}]};
  }};
  return {auth,db,queries,authCalls,disable:()=>{active=false;},
    switchActor:()=>{owner=OTHER_ACTOR;}, get:()=>structuredClone(record),
    tamper:fn=>{record=fn(record);}};
}

test("validated UTF-16 extraction uses only current original and server actor",async()=>{
 const f=fixture(),result=await createTrustedTypedNoteExtraction(f.auth,f.db).commit(input);
 assert.equal(result.state,"needs-human-review");
 assert.equal(result.revision,2);
 assert.equal(result.organizationId,ORG);
 assert.equal(result.sourceId,SOURCE);
 assert.equal(result.candidatesSha256,f.get().review.candidatesSha256);
 assert.equal(result.sourceSha256,f.get().review.sourceSha256);
 assert.deepEqual(f.authCalls,["signed-in","signed-in","signed-in"]);
 assert.equal(f.queries.length,3);
 assert.deepEqual(f.queries[0].params,[ORG,ACTOR,SOURCE]);
 assert.deepEqual(f.queries[2].params,[ORG,ACTOR,SOURCE]);
 const params=f.queries[1].params;
 assert.deepEqual(params.slice(0,4),[ORG,ACTOR,SOURCE,SHA]);
 assert.equal(JSON.parse(params[4]).candidates[0].excerpt,excerpt);
 assert.equal(JSON.parse(params[4]).candidates[0].rateCents,undefined);
 assert.equal(f.get().original.text,text);
 assert.equal(f.get().scopeReview,null);
 assert.equal(Object.hasOwn(result,"approved"),false);
});

test("invalid, forged and unbounded requests fail before Auth and SQL",async()=>{
 const f=fixture(),api=createTrustedTypedNoteExtraction(f.auth,f.db);
 for(const mutation of [
  {organizationId:"bad"}, {sourceId:"bad"}, {actorId:OTHER_ACTOR},
  {send:true}, {rawExtractionResponse:""},
  {rawExtractionResponse:"x".repeat(32769)},
  {rawExtractionResponse:42},
 ]) await assert.rejects(api.commit({...input,...mutation}));
 assert.equal(f.authCalls.length,0);
 assert.equal(f.queries.length,0);
});

test("forged extractor pricing, offsets or invented source text are not committed",async()=>{
 const mutations=[
  {approved:true,candidates:[{serviceCode:"painting",units:2,start,end:start+excerpt.length,excerpt}]},
  {candidates:[{serviceCode:"painting",units:2,start,end:start+excerpt.length,excerpt,rateCents:1}]},
  {candidates:[{serviceCode:"painting",units:2,start,end:start+excerpt.length,excerpt:"invented"}]},
  {candidates:[{serviceCode:"painting",units:2,start:start+1,end:start+excerpt.length,excerpt}]},
 ];
 for(const mutation of mutations) {
  const f=fixture();
  await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db).commit({
    ...input,rawExtractionResponse:JSON.stringify(mutation)}));
  assert.equal(f.queries.length,1); // Authorized original read only.
  assert.equal(f.get().revision,1);
 }
});

test("stale extraction revision never creates another extraction",async()=>{
 const f=fixture(),api=createTrustedTypedNoteExtraction(f.auth,f.db);
 await api.commit(input);
 await assert.rejects(api.commit(input),/stale or already reviewed/);
 assert.equal(f.queries.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,1);
});

test("cross-tenant selector, foreign creator and authorization revocation deny writes",async()=>{
 const f=fixture(),api=createTrustedTypedNoteExtraction(f.auth,f.db);
 await assert.rejects(api.commit({...input,organizationId:FOREIGN}),/membership/);
 f.switchActor();
 await assert.rejects(api.commit(input),/membership/);
 f.disable();
 await assert.rejects(api.commit(input),/revoked/);
 assert.equal(f.queries.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,0);
});

test("revocation and identity switch between original read and CAS blocks commit",async()=>{
 for(const mode of ["revoke","switch"]) {
  const f=fixture(),read=f.db.query;
  f.db.query=async(sql,params)=>{
    const result=await read(sql,params);
    if(sql.includes("read_typed_note_for_extraction")) {
      if(mode==="revoke")f.disable();
      else f.switchActor();
    }
    return result;
  };
  await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db).commit(input),
    /revoked|identity changed/);
  assert.equal(f.queries.length,1);
 }
});

test("fabricated or inconsistent SQL CAS acknowledgements cannot claim success",async()=>{
 for(const mutate of [
  ()=>({rows:[]}),
  ()=>({rows:[{source_revision:1,original_sha256:SHA,candidates_sha256:"a".repeat(64)}]}),
  ()=>({rows:[{source_revision:2,original_sha256:"0".repeat(64),candidates_sha256:"a".repeat(64)}]}),
 ]) {
  const f=fixture(),original=f.db.query;
  f.db.query=async(sql,params)=>{
    if(sql.includes("commit_typed_note_extraction")) {
      await original(sql,params); // Simulate a remote write that DID commit.
      return mutate();
    }
    return original(sql,params);
  };
  await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db).commit(input),
    /indeterminate/);
  assert.equal(f.get().revision,2);
  assert.equal(f.queries.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,1);
 }
});

test("modified receipt after committing is indeterminate, never approved",async()=>{
 const f=fixture(),query=f.db.query;
 f.db.query=async(sql,params)=>{
  const res=await query(sql,params);
  if(sql.includes("commit_typed_note_extraction")) {
    f.tamper(row=>({...row,review:{...row.review,approved:true}}));
  }
  return res;
 };
 await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db).commit(input));
 assert.equal(f.queries.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,1);
});

test("unavailable trusted providers never become success or automatic retry",async()=>{
 for(const step of ["auth","read","commit"]) {
  const f=fixture();
  if(step==="auth")f.auth.verifyActiveSession=async()=>{throw Error("Auth unavailable");};
  if(step!=="auth") {
    const query=f.db.query;
    f.db.query=async(sql,params)=>{
      if((step==="read"&&sql.includes("read_typed_note_for_extraction"))
        ||(step==="commit"&&sql.includes("commit_typed_note_extraction")))
        throw Error("Primary DB unavailable");
      return query(sql,params);
    };
  }
  await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db).commit(input),
    /unavailable/);
  assert.equal(f.queries.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,0);
 }
});

test("read-only reconcile observes an unprocessed source, never retries",async()=>{
 const f=fixture();
 const state=await createTrustedTypedNoteExtraction(f.auth,f.db).reconcile(input);
 assert.deepEqual(state,{state:"unprocessed-at-read",organizationId:ORG,sourceId:SOURCE});
 assert.equal(f.queries.length,2);
 assert.ok(f.queries.every(q=>q.sql.includes("read_typed_note_for_extraction")));
 assert.equal(f.authCalls.length,2);
});

test("read-only reconcile recovers matching evidence after ambiguous durable CAS",async()=>{
 const f=fixture(),q=f.db.query;
 f.db.query=async(sql,params)=>{
   const result=await q(sql,params);
   if(sql.includes("commit_typed_note_extraction"))throw Error("response lost");
   return result;
 };
 const api=createTrustedTypedNoteExtraction(f.auth,f.db);
 await assert.rejects(api.commit(input),/response lost/);
 const previous=f.queries.length;
 const state=await api.reconcile(input);
 assert.deepEqual(state,{state:"matching-extraction-at-read",
   organizationId:ORG,sourceId:SOURCE,revision:2,
   sourceSha256:f.get().review.sourceSha256,
   candidatesSha256:f.get().review.candidatesSha256});
 assert.equal(f.queries.length,previous+2);
 assert.equal(f.queries.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,1);
 assert.equal(Object.hasOwn(state,"approved"),false);
});

test("reconcile distinguishes an alternate valid extraction without writing",async()=>{
 const f=fixture(),api=createTrustedTypedNoteExtraction(f.auth,f.db);
 await api.commit({...input,rawExtractionResponse:JSON.stringify({candidates:[{
   serviceCode:"inspection",units:1,start,end:start+excerpt.length,excerpt,
 }]})});
 const n=f.queries.length;
 assert.deepEqual(await api.reconcile(input),{
   state:"different-extraction-at-read",organizationId:ORG,sourceId:SOURCE});
 assert.equal(f.queries.length,n+2);
 assert.equal(f.queries.filter(q=>q.sql.includes("commit_typed_note_extraction")).length,1);
});

test("reconcile catches racing authorized updates between read observations",async()=>{
 const f=fixture(),q=f.db.query;
 let once=false;
 f.db.query=async(sql,params)=>{
   const snapshot=await q(sql,params);
   if(!once && sql.includes("read_typed_note_for_extraction")){
     once=true;
     const {parseUntrustedExtraction}=await import("../lib/intake-extraction-adapter.ts");
     const review=parseUntrustedExtraction(initial.original,valid);
     f.tamper(r=>({...r,revision:2,review,extractionAudit:[{
       sourceRevision:2,actorId:ACTOR,sourceSha256:review.sourceSha256,
       candidatesSha256:review.candidatesSha256,
     }]}));
   }
   return snapshot;
 };
 assert.deepEqual(await createTrustedTypedNoteExtraction(f.auth,f.db).reconcile(input),{
   state:"changed-during-read",organizationId:ORG,sourceId:SOURCE});
 assert.equal(f.queries.length,2);
});

test("revocation and malformed source candidates cannot authorize reconciliation",async()=>{
 const f=fixture(),q=f.db.query;
 f.db.query=async(sql,params)=>{
   const value=await q(sql,params);
   if(sql.includes("read_typed_note_for_extraction"))f.disable();
   return value;
 };
 await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db).reconcile(input),
   /revoked/);
 assert.equal(f.queries.length,1);
 const g=fixture(),api=createTrustedTypedNoteExtraction(g.auth,g.db);
 await assert.rejects(api.reconcile({...input,send:true}),/Invalid trusted extraction/);
 assert.equal(g.queries.length,0);
 const forged=JSON.stringify({candidates:[{
   serviceCode:"painting",units:1,start,end:start+excerpt.length,excerpt:"false",
 }]});
 await assert.rejects(api.reconcile({...input,rawExtractionResponse:forged}));
 assert.equal(g.queries.length,1);
});
