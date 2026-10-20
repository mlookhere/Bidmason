import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync,spawn} from "node:child_process";
import {canonicalCompanyPolicyText,companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";
import {readActivePolicy,submitPolicyDraft,reviewPolicyDraft}
  from "../lib/company-policy-revisions.ts";

function args(vars={}) {
  const out=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [key,value] of Object.entries(vars)) {
    if(!/^p[1-9]$/.test(key)||typeof value!=="string")
      throw Error("Invalid policy ledger test bind");
    out.push("-v",key+"="+value);
  }
  out.push("-f","-");
  return out;
}
function sql(source,vars={}) {
  return execFileSync("psql",args(vars),{input:source,encoding:"utf8",
    timeout:12000,stdio:["pipe","pipe","pipe"]}).trim();
}
function concurrent(source,vars={}) {
  return new Promise((resolve,reject)=>{
    const proc=spawn("psql",args(vars),{stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="",done=false;
    const kill=setTimeout(()=>proc.kill("SIGKILL"),13000);
    proc.stdout.on("data",part=>{stdout+=part;});
    proc.stderr.on("data",part=>{stderr+=part;});
    proc.once("error",error=>{
      if(!done){done=true;clearTimeout(kill);reject(error);}
    });
    proc.once("close",code=>{
      if(done)return;
      done=true;clearTimeout(kill);
      resolve({ok:code===0,output:stdout.trim(),error:stderr.trim()});
    });
    proc.stdin.end(source);
  });
}
function policy(revision) {
  return {revision,pricing:{
    policyId:"test-ledger-v"+revision,currency:"USD",
    minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
    services:{cleaning:{label:"Office cleaning",unit:"visit",rateCents:12000+revision,
      billing:"charged"}},
  },tax:{method:"none",bps:0}};
}
function fixture() {
  const org=randomUUID(),submitter=randomUUID(),reviewer=randomUUID(),
    outsider=randomUUID();
  sql(`insert into public.bm_organizations(id,slug,name)
    values (:'p1'::uuid,:'p2'::text,'Durable policy events');
    insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p3'::uuid,'contractor'),
           (:'p1'::uuid,:'p4'::uuid,'owner');`,
    {p1:org,p2:"ledger-"+org,p3:submitter,p4:reviewer});
  return {org,submitter,reviewer,outsider};
}
function submit(f,revision,expectedRev,expectedSha=null) {
  return sql(`set role service_role;
    select submitted_revision||':'||submitted_sha256
    from bm_intake_private.submit_policy_history_draft(
      :'p1'::uuid,:'p2'::uuid,:'p3'::integer,
      ${expectedSha===null?"null::text":":'p4'::text"},
      :'p5'::text);`,
    {p1:f.org,p2:f.submitter,p3:String(expectedRev),
      p4:expectedSha??"",p5:canonicalCompanyPolicyText(policy(revision))});
}
function decide(f,revision,sha,decision,actor=f.reviewer) {
  return sql(`set role service_role;
    select reviewed_status from bm_intake_private.review_policy_history_draft(
      :'p1'::uuid,:'p2'::uuid,:'p3'::integer,:'p4'::text,:'p5'::text);`,
    {p1:f.org,p2:actor,p3:String(revision),p4:sha,p5:decision});
}
function read(f,actor=f.reviewer) {
  const json=sql(`set role service_role;
    select bm_intake_private.read_policy_history(:'p1'::uuid,:'p2'::uuid);`,
    {p1:f.org,p2:actor});
  return json?JSON.parse(json):null;
}
test("real durable policy submission and distinct review agree with TS history",()=>{
  const f=fixture();
  assert.equal(read(f),null);
  const sha=companyPolicySha256(policy(1));
  assert.equal(submit(f,1,0),"1:"+sha);
  let hist=read(f);
  assert.equal(hist.revisions[0].status,"draft");
  assert.equal(hist.activeRevision,null);
  const expectedDraft=submitPolicyDraft(null,{
    organizationId:f.org,submittedBy:f.submitter,policy:policy(1),
    expectedRevision:0,expectedSha256:null});
  assert.deepEqual(hist,expectedDraft);
  assert.throws(()=>submit(f,2,1,sha),/Earlier company policy requires independent review/);
  assert.throws(()=>decide(f,1,sha,"approve",f.submitter),
    /Current independently authorized reviewer required|cannot be self-reviewed/);
  assert.equal(decide(f,1,sha,"approve"),"approved");
  assert.throws(()=>decide(f,1,sha,"approve"),/duplicate key/);
  const approved=reviewPolicyDraft(expectedDraft,{
    organizationId:f.org,reviewedBy:f.reviewer,decision:"approve",
    expectedRevision:1,expectedSha256:sha});
  assert.deepEqual(read(f),approved);
  assert.deepEqual(readActivePolicy(read(f),f.org),policy(1));
  assert.equal(submit(f,2,1,sha),"2:"+companyPolicySha256(policy(2)));
  assert.equal(decide(f,2,companyPolicySha256(policy(2)),"reject"),"rejected");
  assert.equal(read(f).activeRevision,1);
  assert.equal(submit(f,3,2,companyPolicySha256(policy(2))),
    "3:"+companyPolicySha256(policy(3)));
  assert.equal(read(f).revisions[2].status,"draft");
  assert.equal(read(f).revisions[1].status,"rejected");
  assert.deepEqual(readActivePolicy(read(f),f.org),policy(1));
});
test("membership revocation and anonymous role prevent durable approval access",()=>{
  const f=fixture(),sha=companyPolicySha256(policy(1));
  assert.throws(()=>read(f,f.outsider),/Current tenant membership required/);
  assert.throws(()=>decide(f,1,sha,"approve",f.outsider),
    /Current independently authorized reviewer required/);
  assert.equal(sql(`select has_function_privilege('authenticated',
    'bm_intake_private.submit_policy_history_draft(uuid,uuid,integer,text,text)',
    'EXECUTE');`),"f");
  assert.equal(sql(`select has_function_privilege('authenticated',
    'bm_intake_private.review_policy_history_draft(uuid,uuid,integer,text,text)',
    'EXECUTE');`),"f");
  assert.equal(sql(`select has_function_privilege('authenticated',
    'bm_intake_private.read_policy_history(uuid,uuid)','EXECUTE');`),"f");
  submit(f,1,0);
  sql(`delete from public.bm_memberships
    where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
    {p1:f.org,p2:f.reviewer});
  assert.throws(()=>decide(f,1,sha,"approve"),
    /Current independently authorized reviewer required/);
  assert.throws(()=>read(f),/Current tenant membership required/);
  assert.equal(read(f,f.submitter).revisions[0].status,"draft");
});
test("immutable database events cannot be edited or deleted by service_role",()=>{
  const f=fixture(),sha=companyPolicySha256(policy(1));
  submit(f,1,0);decide(f,1,sha,"approve");
  for(const expression of [
    `update bm_intake_private.policy_draft_events
      set submitted_by=:'p2'::uuid where organization_id=:'p1'::uuid`,
    `delete from bm_intake_private.policy_decision_events
      where organization_id=:'p1'::uuid`,
    `update bm_intake_private.policy_submission_heads set revision=1
      where organization_id=:'p1'::uuid`,
  ])assert.throws(()=>sql("set role service_role; "+expression+";",
    {p1:f.org,p2:f.reviewer}),/immutable|cannot|increment|permission denied/);
  assert.equal(read(f).revisions[0].status,"approved");
});
test("six independent PostgreSQL writers cannot duplicate first-ever draft",async()=>{
  const f=fixture();
  const statement=`set role service_role;
    set statement_timeout='10s';
    select submitted_revision from bm_intake_private.submit_policy_history_draft(
      :'p1'::uuid,:'p2'::uuid,0,null::text,:'p3'::text);`;
  const v={p1:f.org,p2:f.submitter,
    p3:canonicalCompanyPolicyText(policy(1))};
  const results=await Promise.all(Array.from({length:6},
    ()=>concurrent(statement,v)));
  assert.equal(results.filter(x=>x.ok).length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>!x.ok).length,5);
  for(const failed of results.filter(x=>!x.ok))
    assert.match(failed.error,/Stale immutable policy submission head/);
  assert.equal(read(f).revisions.length,1);
  assert.equal(read(f).revisions[0].status,"draft");
});
