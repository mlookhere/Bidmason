import test from "node:test";
import assert from "node:assert/strict";
import { createTrustedTypedNoteScopeRecovery }
  from "../lib/trusted-typed-note-scope-recovery.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE="11111111-1111-4111-8111-111111111111";
const ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const expected="a".repeat(64);
const different="b".repeat(64);
const input={session:"private-auth",organizationId:ORG,sourceId:SOURCE,
  sourceSha256:"c".repeat(64),candidatesSha256:"d".repeat(64),
  reviewedSelectionSha256:expected};
const row=(state="matching-scope-at-read",sha=expected)=>({
  observation:state,
  persisted_revision:state==="unreviewed-at-read"?2:3,
  observed_selection_sha256:state==="unreviewed-at-read"?null:sha,
});

function fixture(values=[row(),row()]) {
  let active=true,actor=ACTOR,reads=0,authCalls=0;
  const calls=[];
  const auth={async verifyActiveSession(session){
    authCalls++;
    if(!active||session!=="private-auth")throw Error("Auth revoked");
    return {userId:actor};
  }};
  const db={async query(sql,params){
    calls.push({sql,params});
    if(!sql.includes("bm_intake_private.inspect_typed_note_scope_commit")
      || sql.includes("commit_typed_note_scope_review")
      || params.length!==6)throw Error("Unexpected SQL");
    if(params[0]!==ORG||params[1]!==ACTOR||params[2]!==SOURCE) {
      throw Error("Creator membership or tenant denial");
    }
    const value=values[reads++];
    if(value instanceof Error)throw value;
    if(typeof value==="function")return value();
    return {rows:[structuredClone(value)]};
  }};
  return {api:createTrustedTypedNoteScopeRecovery(auth,db),calls,
    get authCalls(){return authCalls;},get reads(){return reads;},
    revoke(){active=false;},switchActor(){actor=OTHER;},
    db,auth};
}
test("two independent verified PRIMARY reads classify a matching persisted draft",async()=>{
 const f=fixture();
 const result=await f.api.reconcile(input);
 assert.deepEqual(result,{state:"matching-scope-at-read",
   organizationId:ORG,sourceId:SOURCE,persistedRevision:3,
   observedSelectionSha256:expected});
 assert.equal(f.reads,2);
 assert.equal(f.authCalls,2);
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[0].params,[
   ORG,ACTOR,SOURCE,input.sourceSha256,input.candidatesSha256,expected]);
 assert.deepEqual(f.calls[1].params,f.calls[0].params);
 for(const {sql} of f.calls){
   assert.ok(sql.startsWith("select observation"));
   assert.equal(sql.includes("insert"),false);
   assert.equal(sql.includes("update"),false);
   assert.equal(sql.includes("commit_typed_note_scope_review"),false);
 }
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
});
test("unreviewed and stale-policy outcomes do not imply rollback or approval",async()=>{
 for(const [state,sha,rev] of [
  ["unreviewed-at-read",null,2],
  ["matching-stale-policy-at-read",expected,3],
  ["different-scope-at-read",different,3],
 ]) {
   const f=fixture([row(state,sha),row(state,sha)]);
   const v=await f.api.reconcile(input);
   assert.equal(v.state,state);
   assert.equal(v.persistedRevision,rev);
   assert.equal(v.observedSelectionSha256,sha);
   assert.equal(f.calls.length,2);
 }
});
test("changing evidence or policy between independent reads stays indeterminate",async()=>{
 for(const [a,b] of [
  [row("unreviewed-at-read"),row()],
  [row(),row("matching-stale-policy-at-read")],
  [row("different-scope-at-read",different),row()],
  [row("matching-scope-at-read"),row("different-scope-at-read",different)],
 ]) {
  const f=fixture([a,b]);
  assert.deepEqual(await f.api.reconcile(input),
    {state:"changed-during-read",organizationId:ORG,sourceId:SOURCE});
  assert.equal(f.calls.length,2);
 }
});
test("invalid client selectors cannot trigger Auth or private SQL",async()=>{
 const changes=[
  {sourceId:"invalid"},{organizationId:"invalid"},{sourceSha256:"invalid"},
  {candidatesSha256:null},{reviewedSelectionSha256:42},{sessionToken:"bad"},
  {approved:true},{selectedIndices:[0]}, {reviewedSelectionSha256:"F".repeat(64)},
 ];
 for(const change of changes){
  const f=fixture();
  await assert.rejects(f.api.reconcile({...input,...change}),TypeError);
  assert.equal(f.authCalls,0);
  assert.equal(f.reads,0);
 }
});
test("revocation or actor switch between reads blocks any recovery classification",async()=>{
 for(const mode of ["revoke","switchActor"]){
   const f=fixture([()=>{f[mode]();return {rows:[row()]};},row()]);
   await assert.rejects(f.api.reconcile(input),/Auth revoked|identity changed/);
   assert.equal(f.calls.length,1);
 }
 // The session can also be invalidated after the FIRST successful SQL read,
 // before verifying the second identity.
 const f=fixture([()=>{f.revoke();return {rows:[row()]};},row()]);
 await assert.rejects(f.api.reconcile(input),/Auth revoked/);
 assert.equal(f.calls.length,1);
});
test("a failing second primary read never gets converted into a matching claim",async()=>{
 const f=fixture([row(),new Error("Membership revoked in SQL")]);
 await assert.rejects(f.api.reconcile(input),/Membership revoked/);
 assert.equal(f.calls.length,2);
});
test("malformed, contradictory or ambiguous database replies fail closed",async()=>{
 const invalid=[
  {rows:[]}, {rows:[row(),row()]},
  {rows:[{observation:"matching-scope-at-read",
    persisted_revision:2,observed_selection_sha256:expected}]},
  {rows:[{observation:"unreviewed-at-read",
    persisted_revision:2,observed_selection_sha256:expected}]},
  {rows:[{...row(),send:true}]},
  {rows:[row("matching-scope-at-read",different)]},
  {rows:[row("different-scope-at-read",expected)]},
  {rows:[row("matching-stale-policy-at-read",different)]},
  {rows:[row("matching-scope-at-read","invalid")]},
  {rows:[{observation:"bogus",persisted_revision:3,
    observed_selection_sha256:expected}]},
 ];
 for(const response of invalid){
  const f=fixture([()=>response,row()]);
  await assert.rejects(f.api.reconcile(input));
  assert.equal(f.calls.length,1);
 }
});
