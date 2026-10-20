// Intentional opt-in for isolated legacy SQL test fixtures only.
process.env.BIDMASON_CI_DISPOSABLE_POSTGRES="1";

/** Disposable PostgreSQL bridge: SQL projection -> canonical TypeScript
 * economics. This tests the live SQL interface but NOT production Supabase. */
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {companyPolicySha256,canonicalCompanyPolicyText}
 from "../lib/company-policy-fingerprint.ts";
import {createTrustedCorrectedEconomicsPreview}
 from "../lib/trusted-corrected-economics-preview.ts";

const org="dededede-dede-4ede-8ede-dededededede";
const commercial="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
function psql(script,params={}){
 const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
 for(const [name,value] of Object.entries(params)){
  if(!/^p[1-4]$/.test(name)||typeof value!=="string")
   throw Error("Unexpected disposable SQL parameter");
  args.push("-v",name+"="+value);
 }
 return execFileSync("psql",[...args,"-f","-"],{
  input:script,encoding:"utf8",timeout:16000,stdio:["pipe","pipe","pipe"],
 }).trim();
}
function setup(){
 const receipt=JSON.parse(psql("select row_to_json(x) from ("+
  "select source_id::text,decision_sha256 from "+
  "bm_intake_private.corrected_commercial_decisions "+
  "where organization_id=:'p1'::uuid) x;",{p1:org}));
 assert.match(receipt.decision_sha256,/^[a-f0-9]{64}$/);
 let activeActor=commercial,active=true;
 const auth={async verifyActiveSession(session){
  if(!active||session!=="verified-ci-session")throw Error("Auth revoked");
  return {userId:activeActor};
 }};
 let queries=0;
 const db={async query(statement,params){
  queries++;
  assert.equal(statement,
   "select bm_intake_private.read_corrected_internal_preview_inputs("+
   "$1::uuid,$2::uuid,$3::uuid,$4::text) as projection");
  assert.equal(params.length,4);
  const sql=statement.replace(/\$([1-4])(?=::)/g,
   (_match,n)=>":'p"+n+"'");
  if(sql.includes("$"))throw Error("Unbound private SQL variable");
  const values=Object.fromEntries(params.map((v,i)=>["p"+(i+1),v]));
  const out=psql("set role service_role;select row_to_json(x) from ("+
   sql+") x;",values);
  return {rows:out?[JSON.parse(out)]:[]};
 }};
 const selector={organizationId:org,sourceId:receipt.source_id,
  expectedDecisionSha256:receipt.decision_sha256,session:"verified-ci-session"};
 return {auth,db,selector,get queries(){return queries;},
  as:(user)=>activeActor=user,revoke:()=>active=false};
}

test("PostgreSQL returns only reviewed source lines and requires digest-parity pricing",async()=>{
 const f=setup();
 const response=await f.db.query(
  "select bm_intake_private.read_corrected_internal_preview_inputs("+
  "$1::uuid,$2::uuid,$3::uuid,$4::text) as projection",
  [org,commercial,f.selector.sourceId,f.selector.expectedDecisionSha256]);
 const p=response.rows[0].projection;
 assert.equal(p.state,"preview-only");
 assert.equal(p.deliveryAuthorized,false);
 assert.deepEqual(p.requested,[{serviceCode:"painting",units:3}]);
 assert.equal(p.policy.pricing.services.painting.rateCents,23000);
 assert.equal(p.evidence.policyRevision,1);
 const adapter=createTrustedCorrectedEconomicsPreview(f.auth,f.db,"disposable-postgres-test-no-session-lock");
 // No conditional pass: the database must contain precisely the canonical
 // bytes computed by the production TypeScript serializer.
 assert.equal(canonicalCompanyPolicyText(p.policy),"{\"pricing\":{\"calculationOrder\":\"surcharge-then-discount\",\"currency\":\"USD\",\"minimum\":{\"cents\":0,\"rule\":\"none\"},\"policyId\":\"correction-painting-v1\",\"services\":{\"cleaning\":{\"billing\":\"pending\",\"label\":\"Cleaning\",\"rateCents\":9900,\"unit\":\"visit\"},\"painting\":{\"billing\":\"charged\",\"label\":\"Painting\",\"optionalAddon\":false,\"rateCents\":23000,\"unit\":\"room\"}}},\"revision\":1,\"tax\":{\"bps\":0,\"method\":\"none\"}}");
 assert.equal(companyPolicySha256(p.policy),p.evidence.policySha256,
  "SQL-approved ratecard must be byte-identical to TypeScript canonical policy");
 const out=await adapter.preview(f.selector);
 assert.equal(out.state,"preview-only");
 assert.equal(out.deliveryAuthorized,false);
 assert.equal(out.economics.quote.totalCents,69000);
 assert.equal(out.economics.totalWithTaxCents,69000);
 assert.equal(out.economics.policySha256,p.evidence.policySha256);
 assert.equal(out.evidence.internalDecisionSha256,f.selector.expectedDecisionSha256);
 assert.equal(Object.hasOwn(out,"policy"),false);
 assert.equal(f.queries,2);
});
test("PostgreSQL rejects creator, foreign tenant and revoked reviewer before pricing",async()=>{
 const f=setup(),adapter=createTrustedCorrectedEconomicsPreview(f.auth,f.db,"disposable-postgres-test-no-session-lock");
 f.as("abababab-abab-4bab-8bab-abababababab");
 await assert.rejects(adapter.preview(f.selector),/permission|privilege|required|review/i);
 f.as(commercial);
 await assert.rejects(adapter.preview({...f.selector,
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}),
  /permission|privilege|required|unavailable/i);
 f.revoke();
 await assert.rejects(adapter.preview(f.selector),/revoked/);
 assert.equal(f.queries,2);
});
