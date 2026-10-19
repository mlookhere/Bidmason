import test from "node:test";
import assert from "node:assert/strict";
import {submitPolicyDraft,reviewPolicyDraft}
  from "../lib/company-policy-revisions.ts";
import {companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";
import {createTrustedCompanyPolicyEventRecovery}
  from "../lib/trusted-company-policy-event-recovery.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const submitter="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reviewer="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const other="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const policy={revision:1,pricing:{
  policyId:"internal-1",currency:"USD",
  minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
  services:{cleaning:{label:"Cleaning",unit:"visit",rateCents:12000,billing:"charged"}},
},tax:{method:"none",bps:0}};
const sha=companyPolicySha256(policy);
function draft() {
  return submitPolicyDraft(null,{organizationId:org,submittedBy:submitter,
    policy,expectedRevision:0,expectedSha256:null});
}
function reviewed(status) {
  return reviewPolicyDraft(draft(),{organizationId:org,reviewedBy:reviewer,
    decision:status,expectedRevision:1,expectedSha256:sha});
}
function fixture(history=null,{advanceAfterFirst=false,changeActor=false,
  reviewerRole=true,afterFirstRead=()=>{}}={}) {
  let stored=history,reads=0,writes=0,actor=reviewer,queryCalls=0;
  const auth={async verifyActiveSession(session) {
    if(session==="sub")return {userId:submitter};
    if(session!=="review")throw Error("Invalid session");
    return {userId:actor};
  }};
  const store={async readAuthorized({organizationId,session}) {
    assert.equal(organizationId,org);
    assert.ok(["sub","review"].includes(session));
    reads++;
    const current=structuredClone(stored);
    if(advanceAfterFirst&&reads===1)stored=reviewed("approve");
    if(changeActor&&reads===1)actor=other;
    if(reads===1)afterFirstRead();
    return current;
  }};
  const db={async query(statement,params) {
    queryCalls++;
    assert.ok(statement.includes("public.bm_memberships"));
    assert.ok(statement.includes("for share"));
    assert.equal(params[0],org);
    if(!reviewerRole)return {rows:[]};
    return {rows:[{allowed:1}]};
  }};
  return {service:createTrustedCompanyPolicyEventRecovery(auth,store,db),
    get reads(){return reads;},get writes(){return writes;},
    get queryCalls(){return queryCalls;},
    setHistory(value){stored=value;},
  };
}
const submitInput={organizationId:org,session:"sub",revision:1,
  policySha256:sha,kind:"submission"};
const reviewInput={...submitInput,session:"review",kind:"review",decision:"approve"};
test("read-only submission recovery distinguishes absent, draft and reviewed",async()=>{
  for(const [hist,status,observed] of [
    [null,"not-recorded-at-read",null],
    [draft(),"matching-record-at-read","draft"],
    [reviewed("approve"),"matching-record-at-read","approved"],
    [reviewed("reject"),"matching-record-at-read","rejected"],
  ]) {
    const f=fixture(hist);
    const result=await f.service.reconcile(submitInput);
    assert.deepEqual(result,{organizationId:org,revision:1,policySha256:sha,
      state:status,observedStatus:observed});
    assert.equal(f.reads,2);
    assert.equal(f.queryCalls,0);
    assert.equal(f.writes,0);
  }
});
test("a reviewer can inspect only their own authorized decision",async()=>{
  for(const [hist,status,observed] of [
    [draft(),"not-recorded-at-read","draft"],
    [reviewed("approve"),"matching-record-at-read","approved"],
  ]) {
    const f=fixture(hist);
    assert.deepEqual(await f.service.reconcile(reviewInput),
      {organizationId:org,revision:1,policySha256:sha,
        state:status,observedStatus:observed});
    assert.equal(f.queryCalls,2);assert.equal(f.reads,2);
  }
  await assert.rejects(fixture(reviewed("reject")).service.reconcile(reviewInput),
    /decision or SHA conflicts/);
  await assert.rejects(fixture(draft(),{reviewerRole:false})
    .service.reconcile(reviewInput),/Current independent policy reviewer permission/);
  const self={...reviewInput,session:"sub"};
  await assert.rejects(fixture(draft()).service.reconcile(self),
    /cannot independently review own draft/);
});
test("independently authorized observations detect decision recorded during read",async()=>{
  const f=fixture(draft(),{advanceAfterFirst:true});
  assert.deepEqual(await f.service.reconcile(reviewInput),
    {organizationId:org,revision:1,policySha256:sha,
      state:"changed-during-read"});
  assert.equal(f.writes,0);
});
test("forged SHA, changed actor and unsafe selectors fail closed with no writes",async()=>{
  await assert.rejects(fixture(draft()).service.reconcile({
    ...submitInput,policySha256:"f".repeat(64)}),/another actor or SHA/);
  await assert.rejects(fixture(reviewed("approve"),{changeActor:true})
    .service.reconcile(reviewInput),/identity changed/);
  for(const payload of [
    {...reviewInput,decision:"unknown"},
    {...submitInput,decision:"approve"},
    {...submitInput,kind:"review"},
    {...submitInput,actor:reviewer},
    {...submitInput,revision:0},
    {...submitInput,policySha256:"bad"},
    {...submitInput,organizationId:"not-uuid"},
  ]) {
    const f=fixture(draft());
    await assert.rejects(f.service.reconcile(payload),TypeError);
    assert.equal(f.reads,0);
    assert.equal(f.queryCalls,0);
    assert.equal(f.writes,0);
  }
});

test("policy-event recovery locks reviewer decision and tenant across two reads",async()=>{
  const input={...reviewInput};
  const f=fixture(reviewed("approve"),{afterFirstRead(){
    input.organizationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    input.revision=100;
    input.policySha256="f".repeat(64);
    input.kind="submission";
    input.decision="reject";
    input.session="sub";
  }});
  const actual=await f.service.reconcile(input);
  assert.deepEqual(actual,{organizationId:org,revision:1,policySha256:sha,
    state:"matching-record-at-read",observedStatus:"approved"});
  assert.equal(f.reads,2);
  assert.equal(f.queryCalls,2);
  assert.equal(f.writes,0);
});

test("policy-event recovery rejects hostile selector descriptors before any Auth read",async()=>{
  const hidden={...reviewInput};
  Object.defineProperty(hidden,"send",{value:true});
  const symbol={...reviewInput};
  symbol[Symbol("send")]=true;
  const inherited=Object.assign(Object.create({send:true}),reviewInput);
  let calls=0;
  const accessor={...reviewInput};
  Object.defineProperty(accessor,"decision",{enumerable:true,
    get(){calls++;throw Error("unsafe decision getter");}});
  const accessorOrg={...reviewInput};
  Object.defineProperty(accessorOrg,"organizationId",{enumerable:true,
    get(){calls++;throw Error("unsafe organization getter");}});
  for(const bad of [hidden,symbol,inherited,accessor,accessorOrg]){
    const f=fixture(reviewed("approve"));
    await assert.rejects(f.service.reconcile(bad),
      /Invalid private policy event recovery selector/);
    assert.equal(f.reads,0);
    assert.equal(f.queryCalls,0);
    assert.equal(f.writes,0);
  }
  assert.equal(calls,0);
});

test("forged current membership row cannot report authorized policy review",async()=>{
  const guarded={...reviewInput};
  let reads=0;
  const auth={async verifyActiveSession(){return {userId:reviewer}}};
  const store={async readAuthorized(){reads++;return reviewed("approve")}};
  const poison=[{allowed:1}];
  Object.defineProperty(poison[0],"allowed",{enumerable:true,
    get(){throw Error("untrusted membership getter executed");}});
  const db={async query(){return {rows:poison}}};
  await assert.rejects(createTrustedCompanyPolicyEventRecovery(
    auth,store,db).reconcile(guarded),
    /Current independent policy reviewer permission required/);
  assert.equal(reads,0);
});
