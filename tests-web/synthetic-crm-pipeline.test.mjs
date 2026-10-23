import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {summarizeSyntheticCrmPipeline} from "../lib/synthetic-crm-pipeline.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN="99999999-9999-4999-8999-999999999999";
const P1="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P2="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW="2026-10-22T12:00:00.000Z";
const POLICY={consent:"confirmed",version:1,minimumDelayHours:24,maximumAttempts:2};
const eventId=n=>String(n).padStart(8,"0")+"-dddd-4ddd-8ddd-dddddddddddd";
const mk=(proposalId,recipient,n,kinds)=>{
  const base={organizationId:ORG,proposalId,revision:2,
    sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
    contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient};
  const intent={...base,idempotencyKey:deliveryIdempotencyKey(base)};
  const events=kinds.map((kind,i)=>({
    eventId:eventId(n*10+i+1),organizationId:ORG,
    idempotencyKey:intent.idempotencyKey,recipient,kind,
    observedAt:"2026-10-20T09:"+String(i).padStart(2,"0")+":00.000Z",
  }));
  return {intent,events,policy:POLICY,previousAttempts:[]};
};
const alice=mk(P1,"first@fictional.example",1,[
  "reserved","provider_accepted","provider_delivered"]);
const bob=mk(P1,"second@fictional.example",2,["reserved"]);
const carol=mk(P2,"third@fictional.example",3,[
  "reserved","provider_accepted","provider_bounced"]);
const won={
  eventId:eventId(90),organizationId:ORG,proposalId:P1,revision:1,
  kind:"won",observedAt:"2026-10-21T10:00:00.000Z",
};
const lost={...won,eventId:eventId(91),proposalId:P2,kind:"lost"};
const entries=[alice,bob,carol];
const matrix=[[won],[],[lost]];
const run=(cases=entries,deals=matrix,history=undefined,org=ORG)=>
  summarizeSyntheticCrmPipeline(org,cases,NOW,deals,history);

test("event-backed redacted CRM summary counts cases and unique proposal outcomes",()=>{
  const report=run();
  assert.deepEqual(report,{
    state:"crm-simulation-only",reviewedCases:3,distinctProposals:2,
    delivery:{notStarted:0,reserved:1,accepted:0,reportedDelivered:1,bounced:1},
    deals:{unverified:0,won:1,lost:1},
    attention:{stopContact:1,operatorReview:0,deferred:2},
    contactAuthorized:false,dataComplete:false,
  });
  const output=JSON.stringify(report);
  for(const identifier of [ORG,P1,P2,"first@fictional.example",
    "second@fictional.example","dryrun_","idempotencyKey","recipientSha256"])
    assert.equal(output.includes(identifier),false);
});

test("missing deal evidence is unverified, NEVER fictional open or authorized",()=>{
  const result=run(entries,[[],[],[]]);
  assert.deepEqual(result.deals,{unverified:2,won:0,lost:0});
  assert.equal(result.contactAuthorized,false);
  assert.equal(result.dataComplete,false);
  assert.equal(result.distinctProposals,2);
});

test("different recipients of one proposal cannot double-count its outcome",()=>{
  const report=run([alice,bob],[[won],[won]]);
  assert.deepEqual(report.deals,{unverified:0,won:1,lost:0});
  assert.equal(report.distinctProposals,1);
  assert.equal(report.reviewedCases,2);
  const other=run([bob,alice],[[],[won]]);
  assert.deepEqual(other.deals,report.deals);
});

test("missing, decorated, sparse or accessor-backed deal matrices fail closed",()=>{
  for(const value of [undefined,null,[],[[]],[[],[],[],[]],
    new Array(3),[[],[],[],"decoration"]]){
    assert.throws(()=>summarizeSyntheticCrmPipeline(ORG,entries,NOW,value),
      /Full synthetic CRM outcome matrix required/);
  }
  const decorated=[[],[],[]];decorated.extra=true;
  assert.throws(()=>run(entries,decorated),/Full synthetic CRM outcome matrix required/);
  let reads=0;
  const accessor=[[],[],[]];
  Object.defineProperty(accessor,"0",{enumerable:true,get(){
    reads++;throw Error("should not be called");
  }});
  assert.throws(()=>run(entries,accessor),/Full synthetic CRM outcome matrix required/);
  assert.equal(reads,0);
});

test("cross-tenant cases, invalid source events and forged revision hashes reject whole rollup",()=>{
  const foreignBase={...alice.intent,organizationId:FOREIGN};
  const foreign={...alice,intent:{...foreignBase,
    idempotencyKey:deliveryIdempotencyKey(
      Object.fromEntries(Object.entries(foreignBase).filter(([k])=>k!=="idempotencyKey")))},
    events:alice.events.map(e=>({...e,organizationId:FOREIGN}))};
  assert.throws(()=>run([foreign],[[]]),/Cross-tenant|Invalid|cross-tenant/);
  const impossible={...alice,events:[alice.events[2]]};
  assert.throws(()=>run([impossible],[[]]),/Unexpected provider delivery/);
  const forged={...bob,intent:{...bob.intent,contentSha256:"e".repeat(64)}};
  assert.throws(()=>run([alice,forged],[[won],[]]),/Invalid simulated delivery identity/);
});

test("conflicting terminal outcomes and replayed event IDs cannot inflate deal counts",()=>{
  assert.throws(()=>run([alice,bob],[[won],[{...won,eventId:eventId(92),kind:"lost"}]]),
    /Conflicting synthetic CRM proposal terminal outcomes/);
  const replay={...bob,events:bob.events.map((event,i)=>i===0
    ?{...event,eventId:alice.events[0].eventId}:event)};
  assert.throws(()=>run([alice,replay],[[won],[]]),
    /Cross-proposal simulated review event ID collision/);
});

test("full per-recipient history is required if history is supplied",()=>{
  assert.throws(()=>run(entries,matrix,[[]]),/Invalid recipient history matrix/);
  assert.throws(()=>run(entries,matrix,new Array(3)),/Invalid recipient history matrix/);
  const ok=run(entries,matrix,[[],[],[]]);
  assert.deepEqual(ok.deals,{unverified:0,won:1,lost:1});
  assert.equal(ok.contactAuthorized,false);
});

test("closed outcomes remain counted across revision-separated current recipients",()=>{
  const previousRevision={...alice.intent,revision:1};
  const earlier={...alice,
    intent:{...previousRevision,idempotencyKey:deliveryIdempotencyKey(
      Object.fromEntries(Object.entries(previousRevision).filter(([k])=>k!=="idempotencyKey")))},
  };
  const earlierEvents=alice.events.map((event,i)=>({
    ...event,idempotencyKey:earlier.intent.idempotencyKey,eventId:eventId(50+i),
  }));
  const report=run([alice,{...earlier,events:earlierEvents}],[[won],[]]);
  assert.deepEqual(report.deals,{unverified:0,won:1,lost:0});
  assert.equal(report.distinctProposals,1);
  assert.equal(report.attention.deferred,2);
});
