import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createBuyerViewGrant, verifyBuyerViewGrant}
  from "../lib/buyer-view-grant.ts";
import {summarizeSyntheticBuyerInbox} from "../lib/synthetic-buyer-inbox.ts";

const NOW=1_791_000_000;
const ID={
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision:3,recipientSha256:"c".repeat(64),contentSha256:"d".repeat(64),
};
const KEY=randomBytes(32);
const issued=NOW-300;
const token=()=>createBuyerViewGrant(ID,KEY,issued,600);
const UUID_A="11111111-1111-4111-8111-111111111111";
const UUID_B="22222222-2222-4222-8222-222222222222";
const draft=(kind="question",note="Is a new start date possible?")=>
  ({...ID,kind,note});
const event=(eventId=UUID_A,viewToken=token(),kind="question",observedAtSeconds=NOW-200)=>({
  eventId,viewToken,draft:draft(kind),observedAtSeconds,
});
const run=(events,changed={})=>summarizeSyntheticBuyerInbox(
  changed.identity??ID,changed.key??KEY,changed.now??NOW,
  changed.revoked??[],events,
);

test("redacted fictional inbox aggregates independent grants and always blocks sending",()=>{
  const records=[event(UUID_A,token(),"question",NOW-200),
    event(UUID_B,token(),"request_changes",NOW-100)];
  const result=run(records);
  assert.deepEqual(result,{
    state:"inbox-simulation-only",eventsReviewed:2,
    questions:1,changeRequests:1,declines:0,
    operatorReviewRequired:2,
    responseSubmitted:false,contactAuthorized:false,dataComplete:false,
  });
  const json=JSON.stringify(result);
  for(const sensitive of [records[0].viewToken,records[1].viewToken,
    ID.organizationId,ID.proposalId,ID.recipientSha256,records[0].draft.note,
    "eventId","grantId","fingerprint","url"])assert.equal(json.includes(sensitive),false);
});

test("fictional decline counts once without granting buyer approval or contact",()=>{
  const record=event(UUID_A,token(),"decline");
  record.draft.note="";
  const result=run([record]);
  assert.deepEqual({
    reviewed:result.eventsReviewed,declines:result.declines,
    questions:result.questions,changes:result.changeRequests,
    submitted:result.responseSubmitted,contact:result.contactAuthorized,
  },{reviewed:1,declines:1,questions:0,changes:0,
    submitted:false,contact:false});
});

test("duplicate event ID or reused grant rejects entire summary, not partial counts",()=>{
  const first=event(UUID_A,token(),"question",NOW-200);
  const second=event(UUID_B,token(),"request_changes",NOW-100);
  assert.throws(()=>run([first,{...second,eventId:first.eventId}]),
    /Invalid fictional buyer inbox evidence/);
  assert.throws(()=>run([first,{...second,viewToken:first.viewToken}]),
    /Inconsistent fictional buyer inbox evidence/);
});

test("chronological gaps, future timestamps and malformed dates fail closed",()=>{
  const first=event(UUID_A,token(),"question",NOW-200);
  const second=event(UUID_B,token(),"request_changes",NOW-100);
  for(const broken of [
    [second,first],
    [first,{...second,observedAtSeconds:NOW+1}],
    [first,{...second,observedAtSeconds:NaN}],
    [first,{...second,observedAtSeconds:"yesterday"}],
    [first,{...second,observedAtSeconds:-1}],
  ])assert.throws(()=>run(broken),/Invalid fictional buyer inbox evidence/);
  assert.throws(()=>run([first],{now:-1}),/Invalid fictional buyer inbox evidence/);
});

test("expired, revoked, mis-signed and foreign-tenant responses cannot enter the inbox",()=>{
  const issuedOld=createBuyerViewGrant(ID,KEY,NOW-800,120);
  const verifiedFirst=event(UUID_A,token());
  const forged=token().slice(0,-1)+"!";
  for(const broken of [
    {...verifiedFirst,viewToken:issuedOld},
    {...verifiedFirst,viewToken:forged},
    {...verifiedFirst,draft:{...verifiedFirst.draft,organizationId:
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}},
    {...verifiedFirst,draft:{...verifiedFirst.draft,revision:4}},
    {...verifiedFirst,draft:{...verifiedFirst.draft,contentSha256:"e".repeat(64)}},
  ]){
    assert.throws(()=>run([broken]),/Inconsistent fictional buyer inbox evidence/);
  }
  // A signed but revoked grant must also fail during event assessment.
  const prior=verifyBuyerViewGrant(verifiedFirst.viewToken,ID,KEY,NOW-200);
  assert.equal(prior.state,"signed-claims-only");
  assert.throws(()=>run([verifiedFirst],{revoked:[prior.grantId]}),
    /Inconsistent fictional buyer inbox evidence/);
  assert.throws(()=>run([verifiedFirst],{revoked:["not-a-grant"]}),
    /Invalid nonbinding buyer-response evidence/);
});

test("malicious response text and explicit approval/send attempts fail closed",()=>{
  for(const invalid of [
    {...draft(),kind:"approve"}, {...draft(),kind:"submit"},
    {...draft(),note:"<script>submit()</script>"},
    {...draft(),note:"hidden\u202eAPPROVE"},
    {...draft(),note:"line\nbreak"},
  ]){
    const value={...event(),draft:invalid};
    assert.throws(()=>run([value]),/Invalid nonbinding buyer-response evidence/);
  }
});

test("missing or hostile event containers are rejected without calling getters",()=>{
  for(const records of [undefined,null,{},[],new Array(1),[null],
    Array.from({length:101},()=>event()),[event(),{}]]){
    assert.throws(()=>run(records),/Invalid fictional buyer inbox evidence|Invalid nonbinding/);
  }
  const decorated=[event()];decorated.extra=1;
  assert.throws(()=>run(decorated),/Invalid fictional buyer inbox evidence/);
  let reads=0;
  const hostile=[event()];
  Object.defineProperty(hostile,"0",{enumerable:true,get(){
    reads++;throw Error("GETTER SHOULD NOT RUN");
  }});
  assert.throws(()=>run(hostile),/Invalid fictional buyer inbox evidence/);
  assert.equal(reads,0);
  const accessor=event();
  Object.defineProperty(accessor,"viewToken",{enumerable:true,get(){
    reads++;throw Error("GETTER SHOULD NOT RUN");
  }});
  assert.throws(()=>run([accessor]),/Invalid fictional buyer inbox evidence/);
  assert.equal(reads,0);
});

test("malformed or wrong-scope identities never produce a fictional status",()=>{
  const record=event();
  for(const wrong of [
    {...ID,organizationId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
    {...ID,proposalId:"ffffffff-ffff-4fff-8fff-ffffffffffff"},
    {...ID,revision:ID.revision+1},
  ])assert.throws(()=>run([record],{identity:wrong}),
    /Inconsistent fictional buyer inbox evidence/);
});

test("synthetic evidence never establishes durable authenticity or response authority",()=>{
  const result=run([event()]);
  assert.equal(result.state,"inbox-simulation-only");
  assert.equal(result.operatorReviewRequired,result.eventsReviewed);
  assert.equal(result.responseSubmitted,false);
  assert.equal(result.contactAuthorized,false);
  assert.equal(result.dataComplete,false);
});
