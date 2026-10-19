import test from "node:test";
import assert from "node:assert/strict";
import {companyPolicySha256} from "../lib/company-policy-fingerprint.ts";
import {createTrustedSessionLockedCorrectedEconomicsPreview}
 from "../lib/trusted-corrected-economics-preview.ts";
import {createSessionBoundSupabaseVerifier}
 from "../lib/supabase-session-bound-verifier.ts";

const org="dededede-dede-4ede-8ede-dededededede";
const source="aaaa1111-aaaa-4aaa-8aaa-aaaa1111aaaa";
const actor="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const sessionId="11111111-1111-4111-8111-111111111111";
const secondId="22222222-2222-4222-8222-222222222222";
const decision="a".repeat(64), digest="b".repeat(64);
const policy={revision:1,pricing:{
 policyId:"internal-locked-preview",currency:"USD",
 calculationOrder:"surcharge-then-discount",
 minimum:{rule:"none",cents:0},
 services:{painting:{label:"Painting",unit:"room",billing:"charged",
  rateCents:23000,optionalAddon:false}}},
 tax:{method:"none",bps:0}};
const snapshot=()=>({
 state:"preview-only",deliveryAuthorized:false,
 policy:structuredClone(policy),requested:[{serviceCode:"painting",units:3}],
 evidence:{organizationId:org,sourceId:source,revision:5,
  sourceSha256:digest,correctedCandidatesSha256:digest,
  scopeReceiptSha256:digest,internalDecisionSha256:decision,
  policySha256:companyPolicySha256(policy),policyRevision:1},
});
const input=()=>({organizationId:org,sourceId:source,
 expectedDecisionSha256:decision,session:"opaque-private-bearer"});
function fixture(){
 let currentSessionId=sessionId,authCalls=0,sqlCalls=0,projection=snapshot();
 let invalidate=false;
 const sql=[];
 const auth={
   async verifySessionBinding(session){
    authCalls++;
    if(invalidate||session!=="opaque-private-bearer")
      throw Error("Auth session revoked");
    return {userId:actor,sessionId:currentSessionId};
   },
   async verifyActiveSession(){throw Error("Unsafe JWT-only verifier used");}
 };
 const db={async query(statement,params){
  sqlCalls++;sql.push({statement,params});
  assert.equal(statement,
   "select bm_intake_private.read_corrected_internal_preview_session_locked("+
   "$1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) as projection");
  assert.deepEqual(params,[org,actor,sessionId,source,decision]);
  return {rows:[{projection}]};
 }};
 return {api:createTrustedSessionLockedCorrectedEconomicsPreview(auth,db),
  sql,
  get sqlCalls(){return sqlCalls;},get authCalls(){return authCalls;},
  changeSession(id){currentSessionId=id;},
  revoke(){invalidate=true;},
  projection(v){projection=v}};
}
test("internal corrected pricing uses the locked 5-argument SQL path",async()=>{
 const f=fixture(),result=await f.api.preview(input());
 assert.equal(result.economics.quote.totalCents,69000);
 assert.equal(result.deliveryAuthorized,false);
 assert.equal(result.state,"preview-only");
 assert.equal(result.economics.policySha256,companyPolicySha256(policy));
 assert.equal(f.sqlCalls,1);
 assert.equal(f.authCalls,2);
 assert.equal(Object.hasOwn(result,"policy"),false);
 assert.equal(Object.hasOwn(result,"sessionId"),false);
});
test("unbound Auth adapter cannot be used to invoke locked SQL",async()=>{
 assert.throws(()=>createTrustedSessionLockedCorrectedEconomicsPreview(
  {async verifyActiveSession(){return {userId:actor};}},
  {async query(){throw Error("must not query");}}),/Session-bound/);
});
test("JWT-authenticated session rotation after SQL read fails closed",async()=>{
 const f=fixture();
 // Rotate only on return from the one trusted SQL call.
 const old=f.sql;
 const auth={
  async verifySessionBinding(){return {userId:actor,sessionId:sessionId};}
 };
 let calls=0;
 const database={async query(sql,params){
   calls++;assert.equal(params[2],sessionId);
   auth.verifySessionBinding=async()=>({userId:actor,sessionId:secondId});
   return {rows:[{projection:snapshot()}]};
 }};
 const service=createTrustedSessionLockedCorrectedEconomicsPreview(auth,database);
 await assert.rejects(service.preview(input()),/session changed/);
 assert.equal(calls,1);
 assert.equal(old.length,0);
});
test("invalid verified session identity and forged caller session id do not reach DB",async()=>{
 for(const current of [
  {userId:actor}, {userId:actor,sessionId:"bad"},
  {userId:actor,sessionId:sessionId,extra:true},
  {userId:"00000000-0000-0000-0000-000000000000",sessionId},
 ]) {
   let queries=0;
   const service=createTrustedSessionLockedCorrectedEconomicsPreview({
    async verifySessionBinding(){return current;}
   },{async query(){queries++;return {rows:[{projection:snapshot()}]};}});
   await assert.rejects(service.preview(input()));
   assert.equal(queries,0);
 }
 for(const field of [{sessionId},{actorId:actor},{requested:[{units:100}]},
  {recipient:"customer@example.invalid"},{policy}]){
   const f=fixture();
   await assert.rejects(f.api.preview({...input(),...field}),TypeError);
   assert.equal(f.sqlCalls,0);
 }
});
test("rechecked revoked sessions and tampered prices refuse internal calculation",async()=>{
 for(const kind of ["revoked","policy-sha","price-change","customer-send"]){
  const f=fixture();
  if(kind==="revoked"){
   // A revocation before initial verification blocks all SQL.
   f.revoke();
   await assert.rejects(f.api.preview(input()),/revoked/);
   assert.equal(f.sqlCalls,0);
  }else{
   const p=snapshot();
   if(kind==="policy-sha")p.evidence.policySha256="0".repeat(64);
   if(kind==="price-change")p.policy.pricing.services.painting.rateCents=1;
   if(kind==="customer-send")p.deliveryAuthorized=true;
   f.projection(p);
   await assert.rejects(f.api.preview(input()));
   assert.equal(f.sqlCalls,1);
  }
 }
});
test("session-bound verifier passes only independently verified session UUID",async()=>{
 const header=Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
 const body=Buffer.from(JSON.stringify({
  sub:actor,session_id:sessionId,
  iat:Math.floor(Date.now()/1000)-100,exp:Math.floor(Date.now()/1000)+1000,
 })).toString("base64url");
 const jwt=header+"."+body+"."+"x".repeat(64);
 const queries=[];
 const auth={async verifyActiveSession(token){
  assert.equal(token,jwt);return {userId:actor};
 }};
 const db={async query(sql,params){
  queries.push({sql,params});
  return {rows:[{active:true}]};
 }};
 const verified=createSessionBoundSupabaseVerifier(auth,db);
 const internal=createTrustedSessionLockedCorrectedEconomicsPreview(verified,{
  async query(sql,params){
   queries.push({sql,params});
   return {rows:[{projection:snapshot()}]};
  },
 });
 const response=await internal.preview({...input(),session:jwt});
 assert.equal(response.economics.quote.totalCents,69000);
 assert.equal(queries.length,3); // twice session probe + locked projection
 assert.deepEqual(queries[0].params,[actor,sessionId]);
 assert.deepEqual(queries[1].params,[org,actor,sessionId,source,decision]);
 assert.deepEqual(queries[2].params,[actor,sessionId]);
});

test("locked pricing refuses invalid or unsafe bearer values before Auth and SQL",async()=>{
 let authCalls=0,sqlCalls=0,getters=0;
 const auth={async verifySessionBinding(){authCalls++;
  return {userId:actor,sessionId};}};
 const db={async query(){sqlCalls++;
  return {rows:[{projection:snapshot()}]};}};
 const api=createTrustedSessionLockedCorrectedEconomicsPreview(auth,db);
 const injected=Object.defineProperty({},"toString",{get(){
  getters++;throw Error("must not stringify bearer");
 }});
 for(const session of [
  null,undefined,0,false,{},injected,new String("opaque-private-bearer"),
  ""," bearer","bearer ","bearer\nnewline","bearer\rnewline",
  "bearer\tpart","bearer\u007fpart","x".repeat(16385),
 ]){
  await assert.rejects(api.preview({...input(),session}),
   /Invalid private corrected economics selector/);
 }
 assert.equal(authCalls,0);
 assert.equal(sqlCalls,0);
 assert.equal(getters,0);
});
