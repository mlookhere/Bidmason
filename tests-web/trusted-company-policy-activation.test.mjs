import test from "node:test";
import assert from "node:assert/strict";
import {submitPolicyDraft,reviewPolicyDraft} from "../lib/company-policy-revisions.ts";
import {companyPolicySha256} from "../lib/company-policy-fingerprint.ts";
import {createTrustedCompanyPolicyActivation}
  from "../lib/trusted-company-policy-activation.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const submitter="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reviewer="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const other="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const session="opaque-reviewer-session";
const request={organizationId:org,reviewerSession:session};
const policy={revision:1,pricing:{
  policyId:"synthetic-v1",currency:"USD",
  calculationOrder:"discount-then-surcharge",
  minimum:{rule:"none",cents:0},
  services:{cleaning:{label:"Cleaning",unit:"visit",rateCents:12000,
    billing:"charged",optionalAddon:false}},
},tax:{method:"none",bps:0}};

function approvedHistory() {
  const draft=submitPolicyDraft(null,{organizationId:org,submittedBy:submitter,
    policy,expectedRevision:0,expectedSha256:null});
  return reviewPolicyDraft(draft,{organizationId:org,reviewedBy:reviewer,
    decision:"approve",expectedRevision:1,
    expectedSha256:draft.revisions[0].policySha256});
}
function fixture(opts={}) {
  let active=true,actor=reviewer;
  let hist=structuredClone(approvedHistory());
  let head=null,authCalls=0,storeReads=0,writes=0;
  const calls=[];
  const auth={async verifyActiveSession(token) {
    authCalls++;
    if(!active||token!==session)throw Error("Session revoked");
    if(authCalls===1)opts.afterFirstAuth?.();
    return {userId:actor};
  }};
  const store={async readAuthorized({organizationId,session:token}) {
    storeReads++;
    if(organizationId!==org||token!==session)throw Error("Unauthorized store read");
    return structuredClone(hist);
  }};
  const db={async query(sql,params) {
    calls.push({sql,params});
    if(sql.includes("active_policy_heads")) {
      assert.deepEqual(params,[org,reviewer]);
      assert.match(sql,/join public\.bm_memberships m/);
      return {rows:head?[structuredClone(head)]:[]};
    }
    if(!sql.includes("activate_scope_policy"))throw Error("Unknown private query");
    writes++;
    assert.equal(params.length,5);
    assert.deepEqual(params.slice(0,4),[org,submitter,reviewer,"1"]);
    if(head)throw Error("Stale head");
    const current=JSON.parse(params[4]);
    if(current.revision!==1)throw Error("Incorrect canonical revision");
    const digest=companyPolicySha256(current);
    head={revision:1,policy_sha256:digest,policy:current,
      submitted_by:submitter,reviewed_by:reviewer};
    opts.afterWrite?.({revoke(){active=false;},switchActor(){actor=other;},
      tamperHead(){head.policy_sha256="0".repeat(64);},
      tamperHistory(){hist.revisions[0].policy.pricing.policyId="altered";}});
    if(opts.lostAck)throw Error("Lost SQL acknowledgement");
    return {rows:[{activated_revision:1,activated_sha256:digest}]};
  }};
  return {api:createTrustedCompanyPolicyActivation(auth,store,db),calls,
    get authCalls(){return authCalls;},
    get storeReads(){return storeReads;},
    get writes(){return writes;},
    revoke(){active=false;},switchActor(){actor=other;},
    setHistory(value){hist=value;},
    get head(){return head;},
  };
}
test("verified reviewer activates one approved policy with two private reads",async()=>{
  const f=fixture();
  const result=await f.api.activate(request);
  assert.deepEqual(result,{state:"activated-for-internal-review",
    organizationId:org,revision:1,policySha256:companyPolicySha256(policy)});
  assert.equal(f.writes,1);
  assert.equal(f.authCalls,6);
  assert.equal(f.storeReads,2);
  assert.equal(f.calls.filter(c=>c.sql.includes("active_policy_heads")).length,2);
  assert.equal(f.calls.filter(c=>c.sql.includes("activate_scope_policy")).length,1);
  assert.equal(Object.hasOwn(result,"send"),false);
  assert.equal(Object.hasOwn(result,"approvedQuote"),false);
  await assert.rejects(f.api.activate(request),/Stale company policy head/);
  assert.equal(f.writes,1);
});
test("client cannot select actor, revision, policy bytes or approval",async()=>{
  for(const change of [
    {organizationId:"bad"},{policy},{submitter},{reviewer},
    {decision:"approve"},{revision:10},{approved:true},{policySha256:"0".repeat(64)},
  ]) {
    const f=fixture();
    await assert.rejects(f.api.activate({...request,...change}),TypeError);
    assert.equal(f.writes,0);
    assert.equal(f.authCalls,0);
  }
});
test("current reviewer must equal distinct historical review actor",async()=>{
  const notReviewer=fixture();notReviewer.switchActor();
  await assert.rejects(notReviewer.api.activate(request),/authenticated distinct reviewer/);
  assert.equal(notReviewer.writes,0);
  const self=fixture(),history=approvedHistory();
  history.revisions[0].reviewedBy=submitter;
  self.setHistory(history);
  await assert.rejects(self.api.activate(request),/Malformed immutable policy history/);
  assert.equal(self.writes,0);
  const forged=fixture(),bad=approvedHistory();
  bad.revisions[0].policy.pricing.services.cleaning.rateCents=1;
  forged.setHistory(bad);
  await assert.rejects(forged.api.activate(request),/integrity check failed/);
  assert.equal(forged.writes,0);
});
test("unreviewed, rejected or missing durable policy cannot reach SQL",async()=>{
  const draft=submitPolicyDraft(null,{organizationId:org,submittedBy:submitter,
    policy,expectedRevision:0,expectedSha256:null});
  const rejected=reviewPolicyDraft(draft,{organizationId:org,reviewedBy:reviewer,
    decision:"reject",expectedRevision:1,
    expectedSha256:draft.revisions[0].policySha256});
  for(const history of [draft,rejected,null]) {
    const f=fixture();f.setHistory(history);
    await assert.rejects(f.api.activate(request));
    assert.equal(f.writes,0);
  }
});
test("post-write identity, history or DB corruption is indeterminate",async()=>{
  for(const [afterWrite,pattern] of [
    [({revoke})=>revoke(),/Session revoked/],
    [({switchActor})=>switchActor(),/Reviewer session changed/],
    [({tamperHead})=>tamperHead(),/malformed|disagrees/],
    [({tamperHistory})=>tamperHistory(),/integrity check failed/],
  ]) {
    const f=fixture({afterWrite});
    await assert.rejects(f.api.activate(request),pattern);
    assert.equal(f.writes,1);
  }
});
test("lost SQL acknowledgement commits once and never retries",async()=>{
  const f=fixture({lostAck:true});
  await assert.rejects(f.api.activate(request),/Lost SQL acknowledgement/);
  assert.equal(f.writes,1);
  assert.equal(f.head.revision,1);
});

test("activation binds original organization and reviewer session across every await",async()=>{
  const mutable={...request};
  const f=fixture({afterFirstAuth(){
    mutable.organizationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mutable.reviewerSession="revoked-late-caller-token";
  }});
  const result=await f.api.activate(mutable);
  assert.equal(result.state,"activated-for-internal-review");
  assert.equal(result.organizationId,org);
  assert.equal(result.revision,1);
  assert.equal(f.writes,1);
  assert.equal(f.storeReads,2);
  assert.equal(f.calls.length,3);
  for(const call of f.calls)assert.equal(call.params[0],org);
});

test("private activation rejects hidden, inherited, symbolic and accessor-backed selectors",async()=>{
  const hidden={...request};
  Object.defineProperty(hidden,"send",{value:true});
  const inherited=Object.assign(Object.create({send:true}),request);
  const symbolic={...request};
  symbolic[Symbol("approved")]=true;
  let getters=0;
  const badTenant={...request};
  Object.defineProperty(badTenant,"organizationId",{enumerable:true,
    get(){getters++;throw Error("unsafe tenant getter");}});
  const badToken={...request};
  Object.defineProperty(badToken,"reviewerSession",{enumerable:true,
    get(){getters++;throw Error("unsafe session getter");}});
  for(const bad of [hidden,inherited,symbolic,badTenant,badToken]){
    const f=fixture();
    await assert.rejects(f.api.activate(bad),
      /Invalid private policy activation selector/);
    assert.equal(f.authCalls,0);
    assert.equal(f.storeReads,0);
    assert.equal(f.writes,0);
  }
  assert.equal(getters,0);
});
