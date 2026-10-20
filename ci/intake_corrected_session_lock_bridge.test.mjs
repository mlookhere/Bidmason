/** Disposable PostgreSQL bridge for the session-LOCKED internal corrected
 * pricing. Auth signature trust is simulated; PG access is real and private.
 * NO customer quote, session DB migration, production deployment or send.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createSessionBoundSupabaseVerifier}
 from "../lib/supabase-session-bound-verifier.ts";
import {createTrustedSessionLockedCorrectedEconomicsPreview}
 from "../lib/trusted-corrected-economics-preview.ts";

const org="dededede-dede-4ede-8ede-dededededede";
const actor="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const sid="11111111-1111-4111-8111-111111111111";
const otherSid="22222222-2222-4222-8222-222222222222";
const PROBE="select bm_intake_private.auth_session_is_active("+
  "$1::uuid,$2::uuid) as active";
const LOCKED="select bm_intake_private.read_corrected_internal_preview_session_locked("+
  "$1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) as projection";
function psql(script,params={}){
 const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
 for(const [name,value] of Object.entries(params)){
  if(!/^p[1-5]$/.test(name)||typeof value!=="string")
    throw Error("Unexpected synthetic SQL parameter");
  args.push("-v",name+"="+value);
 }
 return execFileSync("psql",[...args,"-f","-"],{
  input:script,encoding:"utf8",timeout:16000,stdio:["pipe","pipe","pipe"]
 }).trim();
}
function query(sql,params){
 if(sql!==PROBE && sql!==LOCKED)throw Error("Unexpected private SQL");
 assert.equal(params.length,sql===PROBE?2:5);
 const rendered=sql.replace(/\$([1-5])(?=::)/g,(_,n)=>":'p"+n+"'");
 if(rendered.includes("$"))throw Error("Unbound SQL positional parameter");
 const values=Object.fromEntries(params.map((value,i)=>["p"+(i+1),value]));
 const result=psql("set role service_role;select row_to_json(r) from ("+
    rendered+") r;",values);
 return {rows:result?[JSON.parse(result)]:[]};
}
function createToken(sessionId=sid){
 const when=Math.floor(Date.now()/1000);
 return [
  Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"),
  Buffer.from(JSON.stringify({sub:actor,session_id:sessionId,
   iat:when-120,exp:when+600})).toString("base64url"),
  "x".repeat(64),
 ].join(".");
}
test("real PostgreSQL session-lock projection passes canonical policy and denies signout",async()=>{
 const d=JSON.parse(psql(
  "select row_to_json(r) from (select source_id::text,decision_sha256 "+
  "from bm_intake_private.corrected_commercial_decisions "+
  "where organization_id=:'p1'::uuid) r;",{p1:org}));
 const token=createToken();
 const all=[];
 let authCalls=0;
 const auth={async verifyActiveSession(seen){
   authCalls++;
   assert.equal(seen,token);return {userId:actor};
 }};
 const primary={async query(sql,params){
   all.push({sql,params});return query(sql,params);
 }};
 const verifier=createSessionBoundSupabaseVerifier(auth,primary);
 const service=createTrustedSessionLockedCorrectedEconomicsPreview(verifier,primary);
 const selector={organizationId:org,sourceId:d.source_id,
  expectedDecisionSha256:d.decision_sha256,session:token};
 // Prior mandatory PG test deleted this session. Recreate ONLY ephemeral
 // Auth fixture row, not a production project or an actual JWT signature.
 psql("insert into auth.sessions(id,user_id) "+
  "values (:'p1'::uuid,:'p2'::uuid);",{p1:sid,p2:actor});
 try {
  const out=await service.preview(selector);
  assert.equal(out.state,"preview-only");
  assert.equal(out.deliveryAuthorized,false);
  assert.equal(out.economics.quote.totalCents,69000);
  assert.equal(out.economics.policySha256,out.evidence.policySha256);
  assert.equal(out.evidence.internalDecisionSha256,d.decision_sha256);
  assert.equal(Object.hasOwn(out,"policy"),false);
  assert.equal(all.length,3);
  assert.deepEqual(all.map(c=>c.sql),[PROBE,LOCKED,PROBE]);
  assert.deepEqual(all[1].params,[org,actor,sid,d.source_id,d.decision_sha256]);
  assert.equal(authCalls,2);
  // Delete session after a successful authorized read: despite simulated
  // Auth continuing to authenticate JWT, primary database denies reuse.
  psql("delete from auth.sessions where id=:'p1'::uuid;",{p1:sid});
  const before=all.length;
  await assert.rejects(service.preview(selector),/Current verified Supabase Auth session required/);
  assert.equal(all.length,before+1);
  assert.equal(all.at(-1).sql,PROBE);
  // A different user's valid session cannot be substituted.
  await assert.rejects(service.preview({...selector,session:createToken(otherSid)}));
 } finally {
  psql("delete from auth.sessions where id=:'p1'::uuid;",{p1:sid});
 }
});
