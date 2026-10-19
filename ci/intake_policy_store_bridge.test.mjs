import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {submitCompanyPolicyDraft,reviewCompanyPolicyDraft}
  from "../lib/company-policy-service.ts";
import {readActivePolicy} from "../lib/company-policy-revisions.ts";
import {companyPolicySha256} from "../lib/company-policy-fingerprint.ts";
import {createTrustedPostgresPolicyStore}
  from "../lib/trusted-postgres-policy-store.ts";
import {createTrustedCompanyPolicyActivation}
  from "../lib/trusted-company-policy-activation.ts";

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
    "select activated_revision, activated_sha256",
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
