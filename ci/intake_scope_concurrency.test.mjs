/**
 * Real disposable PostgreSQL contention tests for staged human scope CAS.
 * Independent psql processes exercise actual row locks and immutable evidence.
 * Synthetic members and two-person approval are NOT production authentication.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {spawn,execFileSync} from "node:child_process";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {buildReviewWorkbench} from "../lib/intake-review-workbench.ts";
import {previewReviewedEconomics} from "../lib/intake-quote-preview.ts";
import {canonicalCompanyPolicyText,companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";

const source={kind:"typed-note",text:"Paint 🧱 two rooms and clean the hallway"};
const originalSha=createHash("sha256").update(source.text,"utf8").digest("hex");
function candidate(serviceCode,excerpt,units) {
  const start=source.text.indexOf(excerpt);
  assert.ok(start>=0);
  return {serviceCode,units,start,end:start+excerpt.length,excerpt};
}
const review=prepareExtractionReview(source,[
  candidate("painting","Paint 🧱 two rooms",2),
  candidate("cleaning","clean the hallway",1),
]);
const policy1={revision:1,pricing:{
  policyId:"scope-race-v1",currency:"USD",
  minimum:{rule:"none",cents:0},
  calculationOrder:"discount-then-surcharge",
  services:{
    painting:{label:"Painting",unit:"room",billing:"charged",
      rateCents:11000,optionalAddon:true},
    cleaning:{label:"Hall cleaning",unit:"visit",billing:"charged",
      rateCents:9500,optionalAddon:false},
  },
},tax:{method:"none",bps:0}};
const policy2={...policy1,revision:2,pricing:{...policy1.pricing,
  policyId:"scope-race-v2",
  services:{...policy1.pricing.services,painting:{
    ...policy1.pricing.services.painting,rateCents:14000,
  }},
}};

function psql(script,vars={}) {
  const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [key,value] of Object.entries(vars)) {
    if(!/^p[1-9]$/.test(key)||typeof value!=="string")
      throw new TypeError("Invalid test SQL variable");
    args.push("-v",key+"="+value);
  }
  args.push("-f","-");
  return execFileSync("psql",args,{input:script,encoding:"utf8",
    timeout:12000,maxBuffer:65536}).trim();
}
function parallelPsql(script,vars={}) {
  return new Promise((resolve,reject)=>{
    const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
    for(const [key,value] of Object.entries(vars))args.push("-v",key+"="+value);
    args.push("-f","-");
    const child=spawn("psql",args,{stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="",finished=false;
    const watchdog=setTimeout(()=>child.kill("SIGKILL"),15000);
    child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
    child.stdout.on("data",part=>{stdout+=part;});
    child.stderr.on("data",part=>{stderr+=part;});
    child.once("error",error=>{
      if(!finished){finished=true;clearTimeout(watchdog);reject(error);}
    });
    child.once("close",code=>{
      if(finished)return;
      finished=true;clearTimeout(watchdog);
      resolve({ok:code===0,output:stdout.trim(),error:stderr.trim()});
    });
    child.stdin.end(script);
  });
}
function fixture() {
  const org=randomUUID(),creator=randomUUID(),reviewer=randomUUID(),
    requestId=randomUUID();
  psql(`insert into public.bm_organizations(id,slug,name)
    values (:'p1'::uuid,:'p2'::text,'Concurrent scope review');
    insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p3'::uuid,'operator'),
           (:'p1'::uuid,:'p4'::uuid,'owner');`,
    {p1:org,p2:"scope-race-"+org,p3:creator,p4:reviewer});
  const sha1=psql(`set role service_role;
    select activated_sha256 from bm_intake_private.activate_scope_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,1,:'p4'::text);`,
    {p1:org,p2:creator,p3:reviewer,p4:canonicalCompanyPolicyText(policy1)});
  assert.equal(sha1,companyPolicySha256(policy1));
  const sourceId=psql(`set role service_role;
    select source_id from bm_intake_private.create_typed_note(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:creator,p3:requestId,p4:source.text});
  assert.match(sourceId,/^[a-f0-9-]{36}$/);
  assert.equal(psql(`set role service_role;
    select source_revision from bm_intake_private.commit_typed_note_extraction(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::jsonb);`,
    {p1:org,p2:creator,p3:sourceId,p4:originalSha,
      p5:JSON.stringify(review)}),"2");

  function scope(selectedIndices,acceptedAddonCodes) {
    const model=buildReviewWorkbench(source,review,policy1);
    const selection=previewReviewedEconomics(source,review,selectedIndices,
      policy1,acceptedAddonCodes);
    return {state:"reviewed-for-proposal-draft",sourceRevision:3,
      reviewedBy:creator,reviewKey:model.key,
      sourceSha256:review.sourceSha256,
      candidatesSha256:review.candidatesSha256,
      selectedIndices,acceptedAddonCodes,
      policyRevision:1,policySha256:sha1,
      reviewedSelectionSha256:selection.reviewedSelectionSha256};
  }
  function inspect() {
    return JSON.parse(psql(`select row_to_json(x) from (
      select revision,review,scope_review,extraction_audit,original_text,
        text_sha256,created_by,request_id
      from public.bm_intake_sources
      where organization_id=:'p1'::uuid and id=:'p2'::uuid
    ) x;`,{p1:org,p2:sourceId}));
  }
  function active() {
    return JSON.parse(psql(`select row_to_json(x) from (
      select revision,policy_sha256 from bm_intake_private.active_policy_heads
      where organization_id=:'p1'::uuid
    ) x;`,{p1:org}));
  }
  return {org,creator,reviewer,sourceId,requestId,sha1,
    first:scope([0],["painting"]),second:scope([1],[]),
    inspect,active};
}
function cas(f,scope) {
  return parallelPsql(`set role service_role;
    set statement_timeout='10s';
    select source_revision from bm_intake_private.commit_typed_note_scope_review(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::text,
      :'p6'::jsonb);`,
    {p1:f.org,p2:f.creator,p3:f.sourceId,p4:review.sourceSha256,
      p5:review.candidatesSha256,p6:JSON.stringify(scope)});
}
function activateNext(f) {
  return parallelPsql(`set role service_role;
    set statement_timeout='10s';
    select activated_revision from bm_intake_private.activate_scope_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,2,:'p4'::text);`,
    {p1:f.org,p2:f.creator,p3:f.reviewer,
      p4:canonicalCompanyPolicyText(policy2)});
}
function assertOriginal(f,saved) {
  assert.equal(saved.original_text,source.text);
  assert.equal(saved.text_sha256,originalSha);
  assert.equal(saved.created_by,f.creator);
  assert.equal(saved.request_id,f.requestId);
  assert.deepEqual(saved.review,review);
  assert.equal(saved.extraction_audit.length,1);
  assert.equal(saved.extraction_audit[0].sourceSha256,review.sourceSha256);
  assert.equal(saved.extraction_audit[0].candidatesSha256,review.candidatesSha256);
  assert.equal(saved.extraction_audit[0].actorId,f.creator);
}

test("eight simultaneous identical human scope CAS writers produce exactly one draft",async()=>{
  const f=fixture();
  const results=await Promise.all(Array.from({length:8},()=>cas(f,f.first)));
  const winners=results.filter(x=>x.ok),losers=results.filter(x=>!x.ok);
  assert.equal(winners.length,1,JSON.stringify(results));
  assert.equal(winners[0].output,"3");
  assert.equal(losers.length,7);
  for(const loser of losers)
    assert.match(loser.error,/Scope review source stale or not extracted/);
  const saved=f.inspect();
  assertOriginal(f,saved);
  assert.equal(saved.revision,3);
  assert.deepEqual(saved.scope_review,f.first);
  assert.deepEqual(f.active(),{revision:1,policy_sha256:f.sha1});
});

test("competing valid selections never mix an accepted service with another SHA",async()=>{
  const f=fixture();
  const results=await Promise.all(Array.from({length:6},(_,i)=>
    cas(f,i%2===0?f.first:f.second)));
  const winners=results.filter(x=>x.ok),losers=results.filter(x=>!x.ok);
  assert.equal(winners.length,1,JSON.stringify(results));
  assert.equal(winners[0].output,"3");
  assert.equal(losers.length,5);
  for(const loser of losers)
    assert.match(loser.error,/Scope review source stale or not extracted/);
  const saved=f.inspect();
  assertOriginal(f,saved);
  assert.equal(saved.revision,3);
  assert.ok([f.first.reviewedSelectionSha256,f.second.reviewedSelectionSha256]
    .includes(saved.scope_review.reviewedSelectionSha256));
  const expected=saved.scope_review.reviewedSelectionSha256===
    f.first.reviewedSelectionSha256?f.first:f.second;
  assert.deepEqual(saved.scope_review,expected);
});

test("policy activation and scope CAS serialize without stale-policy success",async()=>{
  const f=fixture();
  const [commit,activation]=await Promise.all([cas(f,f.first),activateNext(f)]);
  assert.equal(activation.ok,true,JSON.stringify(activation));
  assert.equal(activation.output,"2");
  const now=f.active();
  assert.deepEqual(now,{revision:2,
    policy_sha256:companyPolicySha256(policy2)});
  const saved=f.inspect();
  assertOriginal(f,saved);
  if(commit.ok) {
    assert.equal(commit.output,"3");
    assert.equal(saved.revision,3);
    assert.deepEqual(saved.scope_review,f.first);
    assert.equal(saved.scope_review.policySha256,f.sha1);
    assert.notEqual(saved.scope_review.policySha256,now.policy_sha256);
    // Revision 1 was current while the CAS held the policy lock. The
    // persisted draft remains historical; it is not a current price.
  } else {
    // Under READ COMMITTED, a competing policy-head UPDATE can make the
    // FOR SHARE joined head temporarily invisible to this statement.
    // Both outcomes fail closed: no old-policy scope may be persisted.
    assert.match(commit.error,
      /Approved company policy changed; refresh review|Current approved company pricing required/);
    assert.equal(saved.revision,2);
    assert.equal(saved.scope_review,null);
  }
});
