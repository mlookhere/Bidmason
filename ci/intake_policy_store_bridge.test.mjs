import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {submitCompanyPolicyDraft,reviewCompanyPolicyDraft}
  from "../lib/company-policy-service.ts";
import {readActivePolicy} from "../lib/company-policy-revisions.ts";
import {canonicalCompanyPolicyText,companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";
import {createTrustedPostgresPolicyStore}
  from "../lib/trusted-postgres-policy-store.ts";
import {createTrustedCompanyPolicyActivation}
  from "../lib/trusted-company-policy-activation.ts";
import {createTrustedCompanyPolicyRecovery}
  from "../lib/trusted-company-policy-recovery.ts";
import {createTrustedCompanyPolicyEventRecovery}
  from "../lib/trusted-company-policy-event-recovery.ts";

function sql(source,values={}) {
  const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [name,value] of Object.entries(values)) {
    if(!/^p[1-9]$/.test(name)||typeof value!=="string")throw Error("Untrusted DB bind");
    args.push("-v",name+"="+value);
  }
  args.push("-f","-");
  return execFileSync("psql",args,{input:source,encoding:"utf8",
    timeout:13000,stdio:["pipe","pipe","pipe"]}).trim();
}
function databaseQuery(statement,params) {
  if(!Array.isArray(params)||params.length<2||params.length>5
    || !params.every(p=>typeof p==="string"))throw Error("Unexpected SQL args");
  const allowed=[
    "select bm_intake_private.read_policy_history(",
    "select submitted_revision,submitted_sha256",
    "select reviewed_revision,reviewed_sha256,reviewed_status",
    "select h.revision,h.policy_sha256,v.policy,",
    "select v.revision,v.policy_sha256,v.policy,",
    "select activated_revision, activated_sha256",
    "select 1 as allowed from public.bm_memberships",
  ];
  if(!allowed.some(prefix=>statement.startsWith(prefix)))throw Error("Unexpected policy SQL");
  const vals=Object.fromEntries(params.map((p,i)=>["p"+(i+1),p]));
  const bound=statement.replace(/\$([1-5])(?=::)/g,(_m,n)=>":'p"+n+"'");
  if(bound.includes("$"))throw Error("Unbound private SQL");
  const output=sql("set role service_role;select row_to_json(t) from ("+
    bound+") t;",vals);
  return {rows:output?[JSON.parse(output)]:[]};
}
function policy(revision) {
  return {revision,pricing:{
    policyId:"trusted-store-"+revision,currency:"USD",
    minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
    services:{cleaning:{label:"Office",unit:"visit",rateCents:11000+revision,
      billing:"charged",optionalAddon:false}},
  },tax:{method:"none",bps:0}};
}
function fixture() {
  const org=randomUUID(),submitter=randomUUID(),reviewer=randomUUID(),
    outsider=randomUUID();
  sql(`insert into public.bm_organizations(id,slug,name)
    values (:'p1'::uuid,:'p2'::text,'Trusted policy store');
    insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p3'::uuid,'contractor'),
           (:'p1'::uuid,:'p4'::uuid,'owner');`,
    {p1:org,p2:"trust-store-"+org,p3:submitter,p4:reviewer});
  let calls=0,writes=0,revoked=false,afterWrite=null;
  const auth={async verifyActiveSession(session) {
    if(revoked)throw Error("Session revoked");
    if(session==="submitter-session")return {userId:submitter};
    if(session==="reviewer-session")return {userId:reviewer};
    if(session==="outsider-session")return {userId:outsider};
    throw Error("Unknown synthetic session");
  }};
  const db={async query(statement,params) {
    calls++;
    const isWrite=statement.includes("submit_policy_history_draft(")
      || statement.includes("review_policy_history_draft(")
      || statement.includes("activate_scope_policy(");
    const result=databaseQuery(statement,params);
    if(isWrite) {
      writes++;
      if(afterWrite)afterWrite();
    }
    return result;
  }};
  const store=createTrustedPostgresPolicyStore(auth,db);
  return {org,submitter,reviewer,outsider,store,auth,db,
    get calls(){return calls;},get writes(){return writes;},
    revokeSession(){revoked=true;},setAfterWrite(cb){afterWrite=cb;},
    revokeMembership(actor) {
      sql(`delete from public.bm_memberships
        where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
        {p1:org,p2:actor});
    },
  };
}
test("real policy store: submit, approve, activate, reject and preserve prior active",async()=>{
  const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
  assert.equal(await f.store.readAuthorized({organizationId:org,session:rev}),null);
  const draft1=await submitCompanyPolicyDraft(f.store,sub,{
    organizationId:org,policy:policy(1),expectedRevision:0,expectedSha256:null});
  assert.equal(draft1.revisions[0].status,"draft");
  assert.equal(draft1.activeRevision,null);
  const p1=companyPolicySha256(policy(1));
  const approved1=await reviewCompanyPolicyDraft(f.store,rev,{
    organizationId:org,decision:"approve",expectedRevision:1,
    expectedSha256:p1});
  assert.equal(approved1.activeRevision,1);
  assert.deepEqual(readActivePolicy(approved1,org),policy(1));
  const activation=createTrustedCompanyPolicyActivation(f.auth,f.store,f.db);
  const activated=await activation.activate({organizationId:org,reviewerSession:rev});
  assert.equal(activated.revision,1);
  assert.equal(activated.policySha256,p1);
  const draft2=await submitCompanyPolicyDraft(f.store,sub,{
    organizationId:org,policy:policy(2),expectedRevision:1,expectedSha256:p1});
  assert.equal(draft2.activeRevision,1);
  const reject2=await reviewCompanyPolicyDraft(f.store,rev,{
    organizationId:org,decision:"reject",expectedRevision:2,
    expectedSha256:companyPolicySha256(policy(2))});
  assert.equal(reject2.activeRevision,1);
  assert.deepEqual(readActivePolicy(reject2,org),policy(1));
  const draft3=await submitCompanyPolicyDraft(f.store,sub,{
    organizationId:org,policy:policy(3),expectedRevision:2,
    expectedSha256:companyPolicySha256(policy(2))});
  assert.deepEqual(draft3.revisions.map(x=>x.status),
    ["approved","rejected","draft"]);
  assert.deepEqual(await f.store.readAuthorized({organizationId:org,session:rev}),draft3);
  assert.equal(f.writes,6); // submit1, review1, activation1, submit2, reject2, submit3
});
test("real policy store rejects forged history, self-review and stale/revoked authorization",async()=>{
  const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
  await assert.rejects(f.store.mutateAuthorized({organizationId:org,
    session:sub,permission:"draft",transform:()=>{
      return {organizationId:org,activeRevision:null,revisions:[]};
    }}));
  assert.equal(f.writes,0);
  await submitCompanyPolicyDraft(f.store,sub,{
    organizationId:org,policy:policy(1),expectedRevision:0,expectedSha256:null});
  await assert.rejects(reviewCompanyPolicyDraft(f.store,sub,{
    organizationId:org,decision:"approve",expectedRevision:1,
    expectedSha256:companyPolicySha256(policy(1))}));
  assert.equal(f.writes,1);
  await assert.rejects(submitCompanyPolicyDraft(f.store,sub,{
    organizationId:org,policy:policy(2),expectedRevision:1,
    expectedSha256:companyPolicySha256(policy(1))}));
  assert.equal(f.writes,1);
  await assert.rejects(f.store.readAuthorized({
    organizationId:org,session:"outsider-session"}));
  f.revokeMembership(f.reviewer);
  await assert.rejects(reviewCompanyPolicyDraft(f.store,rev,{
    organizationId:org,decision:"approve",expectedRevision:1,
    expectedSha256:companyPolicySha256(policy(1))}));
  assert.equal(f.writes,1);
});
test("post-write revocation or acknowledgement loss is not retried",async()=>{
  for(const mode of ["revoked","lost"]) {
    const f=fixture(),org=f.org;
    f.setAfterWrite(()=>{
      if(mode==="revoked")f.revokeSession();
      if(mode==="lost")throw Error("Primary PostgreSQL response lost");
    });
    await assert.rejects(submitCompanyPolicyDraft(f.store,"submitter-session",{
      organizationId:org,policy:policy(1),
      expectedRevision:0,expectedSha256:null,
    }),mode==="lost"?/response lost/:/Session revoked/);
    assert.equal(f.writes,1);
    if(mode==="revoked") {
      await assert.rejects(f.store.readAuthorized({
        organizationId:org,session:"submitter-session"}),/Session revoked/);
    } else {
      assert.equal((await f.store.readAuthorized({
        organizationId:org,session:"submitter-session"})).revisions[0].status,"draft");
    }
  }
});

test("approved policy v3 activates over an immutable rejected v2, never over missing proof",async()=>{
 const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
 const activation=createTrustedCompanyPolicyActivation(f.auth,f.store,f.db);
 const firstSha=companyPolicySha256(policy(1));
 await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,policy:policy(1),
   expectedRevision:0,expectedSha256:null});
 await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,decision:"approve",
   expectedRevision:1,expectedSha256:firstSha});
 assert.equal((await activation.activate({organizationId:org,reviewerSession:rev}))
   .revision,1);
 const rejectedSha=companyPolicySha256(policy(2));
 await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,policy:policy(2),
   expectedRevision:1,expectedSha256:firstSha});
 // Without a separately recorded rejection, no privileged SQL may skip v2.
 const attempt=()=>sql(`set role service_role;
   select activated_revision from bm_intake_private.activate_scope_policy(
     :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,3,:'p4'::text);`,
   {p1:org,p2:f.submitter,p3:f.reviewer,
     p4:canonicalCompanyPolicyText(policy(3))});
 assert.throws(attempt,/Unproven rejected policy revisions/);
 await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
   decision:"reject",expectedRevision:2,expectedSha256:rejectedSha});
 // A rejected v2 alone is insufficient: the target v3 needs an
 // independently approved and SHA-matching event, not just actor UUIDs.
 assert.throws(attempt,/Unproven rejected policy revisions/);
 const sha3=companyPolicySha256(policy(3));
 await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
   policy:policy(3),expectedRevision:2,expectedSha256:rejectedSha});
 assert.throws(attempt,/Unproven rejected policy revisions/);
 await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
   decision:"approve",expectedRevision:3,expectedSha256:sha3});
 const result=await activation.activate({organizationId:org,
   reviewerSession:rev});
 assert.equal(result.revision,3);
 assert.equal(result.policySha256,sha3);
 assert.deepEqual((await f.store.readAuthorized({organizationId:org,
   session:rev})).revisions.map(x=>x.status),
   ["approved","rejected","approved"]);
 assert.equal(JSON.parse(sql(`select row_to_json(t) from (
     select revision,policy_sha256 from bm_intake_private.active_policy_heads
     where organization_id=:'p1'::uuid) t;`,{p1:org})).revision,3);
 assert.equal((await activation.activate({organizationId:org,
   reviewerSession:rev}).then(()=>false,()=>true)),true);
 const events=sql(`select count(*) from bm_intake_private.approved_policy_versions
   where organization_id=:'p1'::uuid;`,{p1:org});
 assert.equal(events,"2"); // v1 and v3; rejected v2 was NEVER activated
});

test("first approved policy may follow rejected v1 only with durable gap evidence",async()=>{
 const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
 const sha1=companyPolicySha256(policy(1)),sha2=companyPolicySha256(policy(2));
 await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
   policy:policy(1),expectedRevision:0,expectedSha256:null});
 await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
   decision:"reject",expectedRevision:1,expectedSha256:sha1});
 await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
   policy:policy(2),expectedRevision:1,expectedSha256:sha1});
 await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
   decision:"approve",expectedRevision:2,expectedSha256:sha2});
 const activated=await createTrustedCompanyPolicyActivation(
   f.auth,f.store,f.db).activate({organizationId:org,reviewerSession:rev});
 assert.equal(activated.revision,2);
 assert.equal(activated.policySha256,sha2);
 const versions=sql(`select string_agg(revision::text,',' order by revision)
   from bm_intake_private.approved_policy_versions
   where organization_id=:'p1'::uuid;`,{p1:org});
 assert.equal(versions,"2");
});


test("read-only recovery distinguishes missing, matching and superseded policy activation",async()=>{
  const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
  const p1=companyPolicySha256(policy(1));
  await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
    policy:policy(1),expectedRevision:0,expectedSha256:null});
  await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
    decision:"approve",expectedRevision:1,expectedSha256:p1});
  const service=createTrustedCompanyPolicyActivation(f.auth,f.store,f.db);
  const recovery=createTrustedCompanyPolicyRecovery(f.auth,f.store,f.db);
  const selector={organizationId:org,reviewerSession:rev,
    revision:1,policySha256:p1};
  const before=f.writes;
  const missing=await recovery.reconcile(selector);
  assert.equal(missing.state,"not-active-at-read");
  assert.equal(missing.observedHeadRevision,null);
  assert.equal(f.writes,before);
  await service.activate({organizationId:org,reviewerSession:rev});
  const matching=await recovery.reconcile(selector);
  assert.equal(matching.state,"matching-active-at-read");
  assert.equal(matching.observedHeadRevision,1);
  assert.equal(matching.observedHeadSha256,p1);
  const p2=companyPolicySha256(policy(2));
  await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
    policy:policy(2),expectedRevision:1,expectedSha256:p1});
  await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
    decision:"approve",expectedRevision:2,expectedSha256:p2});
  await service.activate({organizationId:org,reviewerSession:rev});
  const prior=await recovery.reconcile(selector);
  assert.equal(prior.state,"historical-superseded-at-read");
  assert.equal(prior.observedHeadRevision,2);
  assert.equal(prior.observedHeadSha256,p2);
  assert.equal((await recovery.reconcile({...selector,revision:2,
    policySha256:p2})).state,"matching-active-at-read");
  const written=f.writes;
  await assert.rejects(recovery.reconcile({...selector,policySha256:"f".repeat(64)}),
    /No approved reviewer-owned policy/);
  await assert.rejects(recovery.reconcile({...selector,reviewerSession:sub}),
    /No approved reviewer-owned policy/);
  f.revokeMembership(f.reviewer);
  await assert.rejects(recovery.reconcile(selector));
  assert.equal(f.writes,written);
});
test("lost-acknowledgement activation can only be INSPECTED without writing again",async()=>{
  const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
  const sha=companyPolicySha256(policy(1));
  await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
    policy:policy(1),expectedRevision:0,expectedSha256:null});
  await reviewCompanyPolicyDraft(f.store,rev,{organizationId:org,
    decision:"approve",expectedRevision:1,expectedSha256:sha});
  let attempts=0;
  f.setAfterWrite(()=>{
    attempts++;
    if(attempts===1)throw Error("Simulated lost approval acknowledgement");
  });
  await assert.rejects(createTrustedCompanyPolicyActivation(
    f.auth,f.store,f.db).activate({organizationId:org,reviewerSession:rev}),
    /Simulated lost approval acknowledgement/);
  const prior=f.writes;
  const observation=await createTrustedCompanyPolicyRecovery(
    f.auth,f.store,f.db).reconcile({organizationId:org,
      reviewerSession:rev,revision:1,policySha256:sha});
  assert.equal(observation.state,"matching-active-at-read");
  assert.equal(observation.observedHeadSha256,sha);
  assert.equal(f.writes,prior);
  assert.equal(attempts,1);
});


test("real PostgreSQL reconciles lost draft and review acknowledgements without retries",async()=>{
  const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
  const digest=companyPolicySha256(policy(1));
  const recovery=createTrustedCompanyPolicyEventRecovery(f.auth,f.store,f.db);
  const submitted={organizationId:org,session:sub,kind:"submission",
    revision:1,policySha256:digest};
  const reviewed={organizationId:org,session:rev,kind:"review",
    decision:"approve",revision:1,policySha256:digest};
  const absent=await recovery.reconcile(submitted);
  assert.equal(absent.state,"not-recorded-at-read");
  assert.equal(absent.observedStatus,null);
  const before=f.writes;
  f.setAfterWrite(()=>{throw Error("Simulated lost policy submission ACK");});
  await assert.rejects(submitCompanyPolicyDraft(f.store,sub,{
    organizationId:org,policy:policy(1),expectedRevision:0,
    expectedSha256:null}),/Simulated lost policy submission ACK/);
  f.setAfterWrite(null);
  assert.equal(f.writes,before+1);
  const draftReceipt=await recovery.reconcile(submitted);
  assert.equal(draftReceipt.state,"matching-record-at-read");
  assert.equal(draftReceipt.observedStatus,"draft");
  const pendingReview=await recovery.reconcile(reviewed);
  assert.equal(pendingReview.state,"not-recorded-at-read");
  assert.equal(pendingReview.observedStatus,"draft");
  const afterDraft=f.writes;
  f.setAfterWrite(()=>{throw Error("Simulated lost independent reviewer ACK");});
  await assert.rejects(reviewCompanyPolicyDraft(f.store,rev,{
    organizationId:org,decision:"approve",expectedRevision:1,
    expectedSha256:digest}),/Simulated lost independent reviewer ACK/);
  f.setAfterWrite(null);
  assert.equal(f.writes,afterDraft+1);
  const approvalReceipt=await recovery.reconcile(reviewed);
  assert.equal(approvalReceipt.state,"matching-record-at-read");
  assert.equal(approvalReceipt.observedStatus,"approved");
  const submittedAfterReview=await recovery.reconcile(submitted);
  assert.equal(submittedAfterReview.observedStatus,"approved");
  assert.equal(f.writes,afterDraft+1); // Recovery performed NO writes.
  // A contractor remains able to read their own submission, but MUST NOT
  // be allowed to pose as an independent reviewer or inspect decisions
  // while holding only the contractor role.
  f.revokeMembership(f.reviewer);
  await assert.rejects(recovery.reconcile(reviewed),
    /Current independent policy reviewer permission|Current tenant membership/);
  assert.equal(f.writes,afterDraft+1);
});

test("actual database role downgrade denies independent review inspection",async()=>{
  const f=fixture(),org=f.org,sub="submitter-session",rev="reviewer-session";
  const digest=companyPolicySha256(policy(1));
  await submitCompanyPolicyDraft(f.store,sub,{organizationId:org,
    policy:policy(1),expectedRevision:0,expectedSha256:null});
  sql(`update public.bm_memberships set member_role='contractor'
    where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
    {p1:org,p2:f.reviewer});
  const recovery=createTrustedCompanyPolicyEventRecovery(f.auth,f.store,f.db);
  const previous=f.writes;
  // The reviewer is still a current tenant member allowed to read the
  // durable ledger, but has lost the owner/operator review privilege.
  assert.equal((await f.store.readAuthorized({organizationId:org,
    session:rev})).revisions.length,1);
  await assert.rejects(recovery.reconcile({organizationId:org,
    session:rev,kind:"review",decision:"approve",revision:1,
    policySha256:digest}),/Current independent policy reviewer permission/);
  assert.equal(f.writes,previous);
});
