import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createBuyerViewGrant, verifyBuyerViewGrant}
  from "../lib/buyer-view-grant.ts";
import {reviewSyntheticBuyerPortal}
  from "../lib/synthetic-buyer-portal-review.ts";

const NOW=1_791_000_000;
const IDENTITY={
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision:3,recipientSha256:"c".repeat(64),contentSha256:"d".repeat(64),
};
const SECRET=randomBytes(32);
const TOKEN=createBuyerViewGrant(IDENTITY,SECRET,NOW,120);
const DRAFT={...IDENTITY,kind:"question",note:"Is the start date flexible?"};
const review=(changed={})=>reviewSyntheticBuyerPortal(
  changed.identity??IDENTITY,changed.token??TOKEN,changed.key??SECRET,
  changed.now??NOW,changed.revoked??[],
  Object.hasOwn(changed,"responded")?changed.responded:[],
  Object.hasOwn(changed,"draft")?changed.draft:undefined,
);

test("signed claims provide a redacted simulated view, never actual access",()=>{
  const result=review();
  assert.deepEqual(result,{
    state:"portal-simulation-only",view:"signed-claims-only",
    response:"not-requested",reason:"none",
    contentAccessible:false,responseSubmitted:false,
    contactAuthorized:false,dataComplete:false,
  });
  const json=JSON.stringify(result);
  for(const secret of [TOKEN,IDENTITY.proposalId,IDENTITY.organizationId,
    IDENTITY.recipientSha256,"grantId","fingerprint","url","note"])
    assert.equal(json.includes(secret),false);
});

test("a fictional question remains a nonbinding draft with no private response",()=>{
  const report=review({draft:DRAFT});
  assert.equal(report.state,"portal-simulation-only");
  assert.equal(report.view,"signed-claims-only");
  assert.equal(report.response,"draft-internal-only");
  assert.equal(report.reason,"none");
  assert.equal(report.contentAccessible,false);
  assert.equal(report.responseSubmitted,false);
  assert.equal(report.contactAuthorized,false);
  assert.equal(report.dataComplete,false);
  assert.equal(JSON.stringify(report).includes(DRAFT.note),false);
});

test("request-changes and decline are drafts; acceptance or sending rejected",()=>{
  for(const [kind,note] of [["request_changes","Please correct the dates."],
    ["decline",""]]){
    const report=review({draft:{...DRAFT,kind,note}});
    assert.equal(report.response,"draft-internal-only");
    assert.equal(report.responseSubmitted,false);
  }
  for(const kind of ["accept","approve","approve_and_send","submit"]){
    assert.throws(()=>review({draft:{...DRAFT,kind}}),/Invalid nonbinding/);
  }
});

test("stale, revoked, not-yet-issued and forged view tokens block all actions",()=>{
  const grant=verifyBuyerViewGrant(TOKEN,IDENTITY,SECRET,NOW);
  assert.equal(grant.state,"signed-claims-only");
  for(const changed of [
    {now:NOW-1}, {now:NOW+120}, {revoked:[grant.grantId]},
    {token:TOKEN+"!"},
    {key:randomBytes(32)}, {token:"not-a-grant"},
  ]){
    for(const includeDraft of [false,true]){
      const report=review({...changed,
        ...(includeDraft?{draft:DRAFT}:{})});
      assert.deepEqual(report,{
        state:"portal-simulation-only",view:"blocked",response:"blocked",
        reason:"grant-not-verified",contentAccessible:false,
        responseSubmitted:false,contactAuthorized:false,dataComplete:false,
      });
    }
  }
});

test("any different tenant, recipient, content, proposal or revision denies",()=>{
  for(const changed of [
    {organizationId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
    {proposalId:"ffffffff-ffff-4fff-8fff-ffffffffffff"},
    {revision:4}, {recipientSha256:"e".repeat(64)},
    {contentSha256:"f".repeat(64)},
  ]){
    assert.equal(review({identity:{...IDENTITY,...changed}}).view,"blocked");
    const report=review({draft:{...DRAFT,...changed}});
    assert.equal(report.view,"signed-claims-only");
    assert.equal(report.response,"blocked");
    assert.equal(report.reason,"draft-not-verified");
  }
});

test("supplied response replay history blocks a duplicate simulated draft",()=>{
  const grant=verifyBuyerViewGrant(TOKEN,IDENTITY,SECRET,NOW);
  assert.equal(grant.state,"signed-claims-only");
  const record=review({draft:DRAFT,responded:[grant.grantId]});
  assert.equal(record.view,"signed-claims-only");
  assert.equal(record.response,"blocked");
  assert.equal(record.reason,"response-already-in-supplied-history");
  assert.equal(record.responseSubmitted,false);
  const otherGrant=createBuyerViewGrant(IDENTITY,SECRET,NOW,120);
  const another=review({token:otherGrant,draft:DRAFT,
    responded:[grant.grantId]});
  assert.equal(another.response,"draft-internal-only");
  assert.equal(another.responseSubmitted,false);
});

test("supplied prior response cannot be disguised as no draft requested",()=>{
  const verified=verifyBuyerViewGrant(TOKEN,IDENTITY,SECRET,NOW);
  assert.equal(verified.state,"signed-claims-only");
  const result=review({responded:[verified.grantId]});
  assert.deepEqual(result,{
    state:"portal-simulation-only",view:"signed-claims-only",
    response:"blocked",reason:"response-already-in-supplied-history",
    contentAccessible:false,responseSubmitted:false,
    contactAuthorized:false,dataComplete:false,
  });
  const output=JSON.stringify(result);
  for(const secret of [verified.grantId,TOKEN,IDENTITY.organizationId,
    IDENTITY.proposalId,DRAFT.note])assert.equal(output.includes(secret),false);
  assert.equal(review({responded:[verified.grantId],draft:DRAFT}).reason,
    "response-already-in-supplied-history");
  const unrelated=createBuyerViewGrant(IDENTITY,SECRET,NOW,120);
  assert.equal(review({token:unrelated,responded:[verified.grantId]}).response,
    "not-requested");
  assert.equal(review({token:unrelated,responded:[verified.grantId],
    draft:DRAFT}).response,"draft-internal-only");
});

test("invalid view proof never reveals whether grant ID appears in supplied history",()=>{
  const verified=verifyBuyerViewGrant(TOKEN,IDENTITY,SECRET,NOW);
  assert.equal(verified.state,"signed-claims-only");
  const wrong={...IDENTITY,revision:IDENTITY.revision+1};
  for(const changed of [{identity:wrong},{now:NOW+120},{token:TOKEN+"!"}]){
    const absent=review({...changed,responded:[]});
    const present=review({...changed,responded:[verified.grantId]});
    assert.deepEqual(present,absent);
    assert.equal(present.reason,"grant-not-verified");
    assert.equal(present.contentAccessible,false);
  }
});

test("malicious note, hidden Unicode and untrusted fields fail closed",()=>{
  for(const note of ["<script>send()</script>","hidden\u202eREJECT",
    "extra\nline"," a", "x".repeat(501)]){
    assert.throws(()=>review({draft:{...DRAFT,note}}),/Invalid nonbinding/);
  }
  assert.throws(()=>review({draft:{...DRAFT,canApprove:true}}),/Invalid nonbinding/);
});

test("malformed response history cannot be silently treated as empty",()=>{
  for(const history of [null,{},["not-a-grant"],new Array(1),
    ["a".repeat(32),"b".repeat(32),"c".repeat(32),"d".repeat(32)]]){
    if(Array.isArray(history)&&history.length===4)continue;
    assert.throws(()=>review({responded:history}),/Invalid fictional buyer response history/);
  }
  const own=["a".repeat(32)];own.extra="unreviewed";
  assert.throws(()=>review({responded:own}),/Invalid fictional buyer response history/);
  let reads=0;
  const hostile=["a".repeat(32)];
  Object.defineProperty(hostile,"0",{enumerable:true,get(){
    reads++;throw Error("should not run");
  }});
  assert.throws(()=>review({responded:hostile}),/Invalid fictional buyer response history/);
  assert.equal(reads,0);
});

test("no real buyer, network, durable revocation or confirmed approval is implied",()=>{
  const result=review({draft:DRAFT});
  assert.deepEqual(Object.keys(result).sort(),[
    "contactAuthorized","contentAccessible","dataComplete","reason",
    "response","responseSubmitted","state","view",
  ]);
  assert.equal(result.contentAccessible,false);
  assert.equal(result.responseSubmitted,false);
});
