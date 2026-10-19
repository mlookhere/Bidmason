import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {buildReviewWorkbench} from "../lib/intake-review-workbench.ts";
import {companyPolicySha256} from "../lib/company-policy-fingerprint.ts";
import {createTrustedTypedNoteScopeCommit}
  from "../lib/trusted-typed-note-scope-commit.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE="11111111-1111-4111-8111-111111111111";
const REQUEST="22222222-2222-4222-8222-222222222222";
const original={kind:"typed-note",text:"Paint 🧱 two rooms"};
const textHash=createHash("sha256").update(original.text).digest("hex");
const review=prepareExtractionReview(original,[{serviceCode:"painting",units:2,
  start:0,end:original.text.length,excerpt:original.text}]);
const policy={revision:1,pricing:{
  policyId:"synthetic-v1",currency:"USD",minimum:{rule:"none",cents:0},
  calculationOrder:"discount-then-surcharge",services:{
    painting:{label:"Painting",unit:"room",rateCents:15000,
      billing:"charged",optionalAddon:true},
  }},tax:{method:"none",bps:0}};
const key=buildReviewWorkbench(original,review,policy).key;
const request={session:"signed-in",organizationId:ORG,sourceId:SOURCE,
  reviewKey:key,selectedIndices:[0],acceptedAddonCodes:["painting"]};
const starting={organizationId:ORG,sourceId:SOURCE,revision:2,
  original,review,scopeReview:null,extractionAudit:[{
    sourceRevision:2,actorId:ACTOR,sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
  }],creationAudit:{actorId:ACTOR,requestId:REQUEST,textSha256:textHash}};

function fixture(options={}) {
  let current=structuredClone(starting);
  let activePolicy=structuredClone(policy),active=true,who=ACTOR;
  let currentMember=true,sourceReads=0;
  let authCalls=0, writes=0;
  const calls=[];
  const auth={async verifyActiveSession(token) {
    authCalls++;
    if(!active || token!=="signed-in")throw Error("Session revoked");
    return {userId:who};
  }};
  const db={async query(sql,params) {
    calls.push({sql,params});
    if(sql.includes("read_typed_note_for_extraction")) {
      if(params[1]!==ACTOR || !currentMember)throw Error("Creator denied");
      const sourceRow={record:structuredClone(current)};
      sourceReads++;
      // Simulate membership revoked just AFTER a successful private source
      // read-back, before the final privileged policy query.
      if (options.revokeAfterReadback && sourceReads===2) currentMember=false;
      return {rows:[sourceRow]};
    }
    if(sql.includes("active_policy_heads")) {
      assert.ok(sql.includes("join public.bm_memberships m"));
      assert.match(sql,/for share of h,v,m/);
      assert.deepEqual(params,[ORG,ACTOR]);
      if(!currentMember) return {rows:[]};
      return {rows:[{revision:activePolicy.revision,
        policy_sha256:companyPolicySha256(activePolicy),
        policy:structuredClone(activePolicy),submitted_by:ACTOR,reviewed_by:OTHER}]};
    }
    if(!sql.includes("commit_typed_note_scope_review"))throw Error("Unexpected SQL");
    writes++;
    if(params[1]!==ACTOR || current.revision!==2)throw Error("CAS stale");
    const scope=JSON.parse(params[5]);
    if(scope.reviewKey!==key || scope.sourceSha256!==review.sourceSha256)
      throw Error("Forged CAS input");
    current={...current,revision:3,scopeReview:structuredClone(scope)};
    options.afterWrite?.({revoke:()=>{active=false;},
      switchActor:()=>{who=OTHER;},
      changePolicy:()=>{activePolicy={...policy,revision:2};},
      tamper:()=>{current.scopeReview.reviewedSelectionSha256="0".repeat(64);}});
    if(options.lostAck)throw Error("Provider acknowledgement lost");
    return {rows:[{source_revision:3,
      reviewed_selection_sha256:scope.reviewedSelectionSha256}]};
  }};
  return {api:createTrustedTypedNoteScopeCommit(auth,db),calls,
    get writes(){return writes;},get authCalls(){return authCalls;},
    get record(){return structuredClone(current);},
    switchActor(){who=OTHER;},revoke(){active=false;},
    changePolicy(){activePolicy={...policy,revision:2};},
    tamperPolicy(){activePolicy={...policy,
      pricing:{...policy.pricing,services:{}}};},
  };
}

test("fresh Auth + approved policy + private CAS + primary readback produce review-only draft",async()=>{
  const f=fixture();
  const result=await f.api.commit(request);
  assert.equal(result.state,"reviewed-for-proposal-draft");
  assert.equal(result.revision,3);
  assert.equal(result.reviewedBy,ACTOR);
  assert.equal(f.writes,1);
  assert.equal(f.authCalls,6);
  assert.deepEqual(f.calls.map(x=>x.sql.includes("commit_typed_note_scope_review")),
    [false,false,true,false,false]);
  assert.deepEqual(f.calls[2].params.slice(0,5),[
    ORG,ACTOR,SOURCE,review.sourceSha256,review.candidatesSha256]);
  assert.equal(f.record.scopeReview.reviewKey,key);
  assert.equal(f.record.original.text,original.text);
  assert.equal(f.record.extractionAudit.length,1);
  assert.equal(Object.hasOwn(result,"send"),false);
  assert.equal(Object.hasOwn(result,"approved"),false);
});

test("invalid, forged, unsorted and malformed selection cannot reach Auth or SQL",async()=>{
 const changes=[
  {organizationId:"other"}, {sourceId:"nope"}, {reviewKey:"bad"},
  {selectedIndices:[]}, {selectedIndices:[0,0]},
  {selectedIndices:[2,1]}, {selectedIndices:[-1]},
  {acceptedAddonCodes:["painting","painting"]},
  {acceptedAddonCodes:["bad code"]}, {approved:true}, {actorId:OTHER},
 ];
 for(const change of changes) {
   const f=fixture();
   await assert.rejects(f.api.commit({...request,...change}),TypeError);
   assert.equal(f.authCalls,0);
   assert.equal(f.calls.length,0);
 }
});

test("stale key, invalid service and unacknowledged optional service do not write",async()=>{
 for(const change of [
  {reviewKey:"f".repeat(64)},
  {selectedIndices:[1]},
  {acceptedAddonCodes:[]},
  {acceptedAddonCodes:["unselected"]},
 ]) {
  const f=fixture();
  await assert.rejects(f.api.commit({...request,...change}));
  assert.equal(f.writes,0);
 }
});

test("changed identity, bad active policy and revoked session prevent commit",async()=>{
 const f=fixture();
 f.switchActor();
 await assert.rejects(f.api.commit(request),/Creator denied/);
 assert.equal(f.writes,0);
 const x=fixture();
 x.tamperPolicy();
 await assert.rejects(x.api.commit(request));
 assert.equal(x.writes,0);
 const y=fixture();
 y.revoke();
 await assert.rejects(y.api.commit(request),/Session revoked/);
 assert.equal(y.writes,0);
});

test("lost CAS acknowledgement remains indeterminate and never triggers retry",async()=>{
 const f=fixture({lostAck:true});
 await assert.rejects(f.api.commit(request),/Provider acknowledgement lost/);
 assert.equal(f.writes,1);
 assert.equal(f.record.revision,3);
});
test("revocation or policy change after the only write never claims success",async()=>{
 for(const [afterWrite,pattern] of [
  [({revoke})=>revoke(),/Session revoked/],
  [({changePolicy})=>changePolicy(),/Approved policy changed/],
  [({tamper})=>tamper(),/read-back indeterminate/],
 ]) {
  const f=fixture({afterWrite});
  await assert.rejects(f.api.commit(request),pattern);
  assert.equal(f.writes,1);
 }
});


test("revocation after valid source readback cannot pass the final policy lookup",async()=>{
  const f=fixture({revokeAfterReadback:true});
  await assert.rejects(f.api.commit(request),/No unambiguous approved current policy/);
  assert.equal(f.writes,1);
  assert.equal(f.record.revision,3);
  assert.equal(f.calls.filter(x=>x.sql.includes("active_policy_heads")).length,2);
  assert.equal(Object.hasOwn(f.record,"send"),false);
});
