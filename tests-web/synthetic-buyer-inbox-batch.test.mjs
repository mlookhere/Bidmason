import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {createBuyerViewGrant, verifyBuyerViewGrant}
  from "../lib/buyer-view-grant.ts";
import {summarizeSyntheticBuyerInboxBatch}
  from "../lib/synthetic-buyer-inbox.ts";

const KEY=randomBytes(32);
const NOW=1_791_000_000;
const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FIRST="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const identity=(proposalId=FIRST,organizationId=ORG)=>({
  organizationId,proposalId,revision:3,
  recipientSha256:"d".repeat(64),contentSha256:"f".repeat(64),
});
const event=(id,n,who=identity(),kind="question")=>{
  const viewToken=createBuyerViewGrant(who,KEY,NOW-200,400);
  const draft={...who,kind,note:kind==="decline"?"":"Question about timing?"};
  return {eventId:String(id).padStart(8,"0")+
    "-1111-4111-8111-111111111111",
    viewToken,draft,observedAtSeconds:NOW-100+n};
};
const batch=(streams,changed={})=>summarizeSyntheticBuyerInboxBatch(
  changed.organizationId??ORG,changed.key??KEY,changed.now??NOW,
  changed.revoked??[],streams,
);

test("cross-proposal fictional inbox adds counts, deduplicates proposal totals and redacts",()=>{
  const first=identity(FIRST), second=identity(SECOND);
  const streams=[
    {identity:first,events:[event(1,0,first,"question")]},
    {identity:second,events:[event(2,0,second,"request_changes")]},
    {identity:first,events:[event(3,1,first,"decline")]},
  ];
  const summary=batch(streams);
  assert.deepEqual(summary,{
    state:"inbox-simulation-only",
    streamsReviewed:3,distinctProposals:2,
    eventsReviewed:3,questions:1,changeRequests:1,declines:1,
    operatorReviewRequired:3,responseSubmitted:false,
    contactAuthorized:false,dataComplete:false,
  });
  const output=JSON.stringify(summary);
  for(const sensitive of [ORG,FIRST,SECOND,streams[0].events[0].viewToken,
    streams[0].events[0].draft.note,"grantId","eventId","fingerprint",
    "recipient","proposalId","token"])
    assert.equal(output.includes(sensitive),false);
});

test("terminal buyer decline is consistent across stream order and new grants",()=>{
  const original=identity();
  const question={identity:original,events:[event(31,-1,original,"question")]};
  const decline={identity:original,events:[event(32,0,original,"decline")]};
  const later={identity:original,events:[event(33,1,original,"request_changes")]};
  const sameTime={identity:original,events:[event(34,0,original,"question")]};
  const secondDecline={identity:original,events:[event(35,2,original,"decline")]};
  assert.equal(batch([question,decline]).eventsReviewed,2);
  assert.equal(batch([decline,question]).declines,1);
  for(const contradictory of [later,sameTime,secondDecline]){
    for(const streams of [
      [question,decline,contradictory],
      [contradictory,decline,question],
      [decline,contradictory,question],
    ]){
      assert.throws(()=>batch(streams),
        /Contradictory fictional buyer response after decline/);
    }
  }
  // A different fictional buyer or a newly issued proposal revision is
  // independent of this immutable recipient + proposal + revision.
  const anotherRecipient={...original,recipientSha256:"e".repeat(64)};
  const newRevision={...original,revision:4};
  for(const next of [anotherRecipient,newRevision]){
    const independent={identity:next,events:[event(36,2,next,"question")]};
    const report=batch([decline,independent]);
    assert.equal(report.eventsReviewed,2);
    assert.equal(report.declines,1);
    assert.equal(report.questions,1);
    assert.equal(report.responseSubmitted,false);
    assert.equal(report.contactAuthorized,false);
  }
});

test("one fictional proposal revision must retain its content across buyers",()=>{
  const original=identity(FIRST);
  const changed={...original,recipientSha256:"e".repeat(64),
    contentSha256:"a".repeat(64)};
  const own={identity:original,events:[event(21,0,original)]};
  const altered={identity:changed,events:[event(22,1,changed)]};
  for(const streams of [[own,altered],[altered,own]]){
    assert.throws(()=>batch(streams),
      /Conflicting fictional buyer inbox proposal revision content/);
  }
  // A second recipient may have an independent signed grant for precisely
  // the same immutable document; this must not require identical recipients.
  const secondRecipient={...original,recipientSha256:"e".repeat(64)};
  const valid={identity:secondRecipient,events:[event(23,1,secondRecipient)]};
  assert.equal(batch([own,valid]).eventsReviewed,2);
  assert.equal(batch([own,valid]).distinctProposals,1);

  // New revisions and different proposals are independent document identities.
  const revision={...changed,revision:4};
  const otherProposal={...changed,proposalId:SECOND};
  for(const identity of [revision,otherProposal]){
    const result=batch([own,{identity,events:[event(24,1,identity)]}]);
    assert.equal(result.eventsReviewed,2);
  }
});

test("replayed event UUID is rejected across two otherwise valid streams",()=>{
  const first=identity(),second=identity(SECOND);
  const a=event(1,0,first),b=event(1,1,second);
  assert.throws(()=>batch([
    {identity:first,events:[a]},{identity:second,events:[b]},
  ]),/Replayed fictional buyer inbox batch evidence/);
});

test("reused valid view grant cannot reappear in another stream",()=>{
  const same=identity();
  const a=event(1,0,same),b=event(2,1,same);
  b.viewToken=a.viewToken;
  assert.throws(()=>batch([
    {identity:same,events:[a]},{identity:same,events:[b]},
  ]),/Replayed fictional buyer inbox batch evidence/);
  assert.equal(batch([{identity:same,events:[a]}]).eventsReviewed,1);
});

test("separate tenants and mismatched signed proposal IDs block whole company report",()=>{
  const own=identity(),foreign=identity(SECOND,OTHER);
  const valid={identity:own,events:[event(1,0,own)]};
  const other={identity:foreign,events:[event(2,1,foreign)]};
  assert.throws(()=>batch([valid,other]),/Invalid fictional buyer inbox batch/);
  assert.throws(()=>batch([valid],{organizationId:OTHER}),
    /Invalid fictional buyer inbox batch/);
  const misbound={identity:identity(SECOND),events:[event(3,0,own)]};
  assert.throws(()=>batch([valid,misbound]),
    /Inconsistent fictional buyer inbox evidence/);
});

test("revocation and any invalid second stream reject full batch",()=>{
  const a=identity(),b=identity(SECOND);
  const one=event(1,0,a),two=event(2,1,b);
  const proof=verifyBuyerViewGrant(two.viewToken,b,KEY,NOW-100);
  assert.equal(proof.state,"signed-claims-only");
  assert.throws(()=>batch([
    {identity:a,events:[one]},{identity:b,events:[two]},
  ],{revoked:[proof.grantId]}),/Inconsistent fictional buyer inbox evidence/);
  assert.throws(()=>batch([
    {identity:a,events:[one]},{identity:b,events:[{...two,viewToken:"forged"}]},
  ]),/Inconsistent fictional buyer inbox evidence/);
});

test("sparse, decorated, accessor-based and missing batch evidence fails closed",()=>{
  const good={identity:identity(),events:[event(1,0)]};
  const cases=[undefined,null,{},[],new Array(1),
    Array.from({length:21},()=>good),[good,null]];
  for(const items of cases)
    assert.throws(()=>batch(items),/Invalid fictional buyer inbox batch/);
  const expanded=[good];expanded.extra=true;
  assert.throws(()=>batch(expanded),/Invalid fictional buyer inbox batch/);
  const wrong={...good,extra:"unexpected"};
  assert.throws(()=>batch([wrong]),/Invalid fictional buyer inbox batch/);
  let called=0;
  const arr=[good];
  Object.defineProperty(arr,"0",{enumerable:true,get(){
    called++;throw Error("untrusted array getter");
  }});
  assert.throws(()=>batch(arr),/Invalid fictional buyer inbox batch/);
  const accessor={events:good.events};
  Object.defineProperty(accessor,"identity",{enumerable:true,get(){
    called++;throw Error("untrusted stream getter");
  }});
  assert.throws(()=>batch([accessor]),/Invalid fictional buyer inbox batch/);
  assert.equal(called,0);
});

test("malformed identity and history timestamps cannot be converted into a clean aggregate",()=>{
  const good={identity:identity(),events:[event(1,0)]};
  for(const broken of [
    {...good,identity:{...good.identity,revision:0}},
    {...good,identity:{...good.identity,recipientSha256:"x"}},
    {...good,events:[{...good.events[0],observedAtSeconds:NOW+1}]},
    {...good,events:[{...good.events[0],draft:
      {...good.events[0].draft,kind:"approve"}}]},
  ]){
    assert.throws(()=>batch([good,broken]));
  }
  assert.throws(()=>batch([good],{key:randomBytes(32)}),
    /Inconsistent fictional buyer inbox evidence/);
});
