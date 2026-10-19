import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {submitPolicyDraft,reviewPolicyDraft}
  from "../lib/company-policy-revisions.ts";
import {companyPolicySha256,canonicalCompanyPolicyText}
  from "../lib/company-policy-fingerprint.ts";
import {createTrustedCompanyPolicyActivation}
  from "../lib/trusted-company-policy-activation.ts";

function sql(script,values={}) {
  const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [key,value] of Object.entries(values)) {
    if(!/^p[1-9]$/.test(key)||typeof value!=="string")
      throw Error("Unexpected disposable DB bind");
    args.push("-v",key+"="+value);
  }
  args.push("-f","-");
  return execFileSync("psql",args,{input:script,encoding:"utf8",
    timeout:12000,stdio:["pipe","pipe","pipe"]}).trim();
}
function privateQuery(statement,params) {
  if(!Array.isArray(params)||!params.every(x=>typeof x==="string")
    || !(
      statement.startsWith("select h.revision,h.policy_sha256,v.policy,")
      || statement.startsWith("select activated_revision, activated_sha256")
    ))throw Error("Unsupported private policy statement");
  const required=statement.startsWith("select h.")?2:5;
  if(params.length!==required)throw Error("Unexpected DB parameter count");
  const bindings=Object.fromEntries(params.map((v,i)=>["p"+(i+1),v]));
  const bound=statement.replace(/\$([1-5])(?=::)/g,(_match,i)=>":'p"+i+"'");
  if(bound.includes("$"))throw Error("Unbound policy SQL");
  const output=sql("set role service_role; select row_to_json(t) from ("+
    bound+") t;",bindings);
  return {rows:output?[JSON.parse(output)]:[]};
}
const policy1={revision:1,pricing:{
  policyId:"synthetic-activation-1",currency:"USD",
  minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
  services:{cleaning:{label:"Office",unit:"visit",rateCents:12000,
    billing:"charged",optionalAddon:false}},
},tax:{method:"none",bps:0}};
function approve(current,org,submitter,reviewer,policy) {
  const old=current?.revisions.at(-1);
  const d=submitPolicyDraft(current,{organizationId:org,submittedBy:submitter,
    policy,expectedRevision:old?.revision??0,
    expectedSha256:old?.policySha256??null});
  return reviewPolicyDraft(d,{organizationId:org,reviewedBy:reviewer,
    decision:"approve",expectedRevision:policy.revision,
    expectedSha256:d.revisions.at(-1).policySha256});
}

test("trusted reviewer policy activation bridges durable TS history to real PG",async()=>{
  const org=randomUUID(),submitter=randomUUID(),reviewer=randomUUID();
  sql(`insert into public.bm_organizations(id,slug,name)
    values (:'p1'::uuid,:'p2'::text,'Private activation adapter');
    insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p3'::uuid,'contractor'),
           (:'p1'::uuid,:'p4'::uuid,'owner');`,
    {p1:org,p2:"policy-adapter-"+org,p3:submitter,p4:reviewer});
  let activeReviewer=reviewer;
  let history=approve(null,org,submitter,reviewer,policy1);
  sql(`set role service_role;
    select bm_intake_private.ci_stage_approved_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:submitter,p3:reviewer,
      p4:canonicalCompanyPolicyText(policy1)});
  let reads=0,writes=0,authCalls=0,lostAck=false;
  const session="trusted-ci-review";
  const auth={async verifyActiveSession(provided) {
    authCalls++;
    if(provided!==session)throw Error("Synthetic reviewer session unavailable");
    return {userId:activeReviewer};
  }};
  const store={async readAuthorized({organizationId,session:provided}) {
    reads++;
    if(organizationId!==org||provided!==session) {
      throw Error("Synthetic tenant policy store denied");
    }
    return structuredClone(history);
  }};
  const db={async query(statement,params) {
    if(statement.includes("active_policy_heads")) {
      assert.deepEqual(params,[org,reviewer]);
      assert.ok(statement.includes("join public.bm_memberships m"));
    } else {
      assert.ok(statement.includes("bm_intake_private.activate_scope_policy"));
      assert.equal(params[1],submitter);
      assert.equal(params[2],reviewer);
      writes++;
    }
    const result=privateQuery(statement,params);
    if(lostAck && statement.includes("activate_scope_policy")) {
      throw Error("SQL response lost after durable approval activation");
    }
    return result;
  }};
  const service=createTrustedCompanyPolicyActivation(auth,store,db);
  const input={organizationId:org,reviewerSession:session};
  const first=await service.activate(input);
  assert.deepEqual(first,{state:"activated-for-internal-review",organizationId:org,
    revision:1,policySha256:companyPolicySha256(policy1)});
  assert.equal(reads,2);assert.equal(authCalls,6);assert.equal(writes,1);
  assert.equal(JSON.parse(sql(`select row_to_json(t) from (
    select h.revision,h.policy_sha256,v.submitted_by,v.reviewed_by
    from bm_intake_private.active_policy_heads h
    join bm_intake_private.approved_policy_versions v
      on h.organization_id=v.organization_id
      and h.revision=v.revision and h.policy_sha256=v.policy_sha256
    where h.organization_id=:'p1'::uuid
  ) t;`,{p1:org})).reviewed_by,reviewer);
  await assert.rejects(service.activate(input),/Stale company policy head/);
  assert.equal(writes,1);
  // No reviewer impersonation can activate any subsequent revision.
  const secondPolicy={...policy1,revision:2,pricing:{
    ...policy1.pricing,policyId:"synthetic-activation-2",
    services:{...policy1.pricing.services,cleaning:{
      ...policy1.pricing.services.cleaning,rateCents:14000}},
  }};
  history=approve(history,org,submitter,reviewer,secondPolicy);
  sql(`set role service_role;
    select bm_intake_private.ci_stage_approved_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:submitter,p3:reviewer,
      p4:canonicalCompanyPolicyText(secondPolicy)});
  activeReviewer=submitter;
  await assert.rejects(service.activate(input),/authenticated distinct reviewer/);
  assert.equal(writes,1);
  activeReviewer=reviewer;
  const second=await service.activate(input);
  assert.equal(second.revision,2);assert.equal(second.policySha256,
    companyPolicySha256(secondPolicy));
  assert.equal(writes,2);
  // A revocation from the REAL PG membership table blocks new activation,
  // regardless of previously authorized synthetic history.
  const thirdPolicy={...secondPolicy,revision:3,pricing:{
    ...secondPolicy.pricing,policyId:"synthetic-activation-3"}};
  history=approve(history,org,submitter,reviewer,thirdPolicy);
  sql(`set role service_role;
    select bm_intake_private.ci_stage_approved_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:submitter,p3:reviewer,
      p4:canonicalCompanyPolicyText(thirdPolicy)});
  sql(`delete from public.bm_memberships
    where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
    {p1:org,p2:reviewer});
  await assert.rejects(service.activate(input));
  assert.equal(writes,2); // member-locked head SELECT prevents attempt
  // Restore reviewer, then simulate a lost acknowledgement on the ONLY
  // activation SQL write. The third policy must exist, but no blind retry.
  sql(`insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p2'::uuid,'owner');`,{p1:org,p2:reviewer});
  lostAck=true;
  await assert.rejects(service.activate(input),/SQL response lost/);
  assert.equal(writes,3);
  const final=JSON.parse(sql(`select row_to_json(t) from (
      select revision,policy_sha256
      from bm_intake_private.active_policy_heads
      where organization_id=:'p1'::uuid) t;`,{p1:org}));
  assert.equal(final.revision,3);
  assert.equal(final.policy_sha256,companyPolicySha256(thirdPolicy));
  lostAck=false;
  await assert.rejects(service.activate(input),/Stale company policy head/);
  assert.equal(writes,3);
});
