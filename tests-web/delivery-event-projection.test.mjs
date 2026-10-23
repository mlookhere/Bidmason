import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {projectSimulatedDeliveryEvents} from "../lib/delivery-event-projection.ts";

const base={organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:3,
  sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),
  recipient:"buyer@example.test"};
const intent={...base,idempotencyKey:deliveryIdempotencyKey(base)};
const evt=(kind,index=0)=>({
  eventId:String(index+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind,
  observedAt:"2026-10-20T08:"+String(index).padStart(2,"0")+":00.000Z",
});
const run=events=>projectSimulatedDeliveryEvents(intent,events);

test("fictional delivered/replied timeline has no sending or approval authority",()=>{
  const events=["reserved","provider_accepted","provider_delivered","recipient_replied"].map(evt);
  const before=structuredClone(events), outcome=run(events);
  assert.deepEqual(events,before);
  assert.equal(outcome.state,"simulation-only");
  assert.equal(outcome.delivery,"reported_delivered");
  assert.equal(outcome.replied,true);
  assert.equal(outcome.eventCount,4);
  assert.deepEqual(outcome.suppression,[]);
  for(const field of ["approved","authorized","send","providerMessageId"])
    assert.equal(Object.hasOwn(outcome,field),false);
});

test("duplicate event ID is idempotent only if all evidence is identical",()=>{
  const e=evt("reserved");
  assert.deepEqual(run([e,{...e}]),run([e]));
  assert.throws(()=>run([e,{...e,kind:"provider_accepted"}]),/Conflicting/);
});

test("out-of-order and impossible state transitions fail closed",()=>{
  for(const seq of [
    ["provider_accepted"],["provider_delivered"],["provider_bounced"],
    ["recipient_replied"],["provider_complained"],["reserved","reserved"],
    ["reserved","provider_delivered"],["reserved","provider_accepted","provider_accepted"],
    ["reserved","provider_accepted","provider_bounced","provider_delivered"],
  ]){
    assert.throws(()=>run(seq.map(evt)),/Unexpected|repeated|Suppressed/);
  }
  assert.throws(()=>run([evt("reserved",3),evt("provider_accepted",2)]),/Out-of-order/);
});

test("equal-time distinct events are ambiguous, but exact event-ID replay remains safe",()=>{
  const reserved=evt("reserved",0),accepted=evt("provider_accepted",1);
  const sameTime={...accepted,observedAt:reserved.observedAt};
  assert.throws(()=>run([reserved,sameTime]),/ambiguous/);
  const delivered=evt("provider_delivered",2);
  const optOut=evt("recipient_opted_out",3);
  const complaint={...evt("provider_complained",4),observedAt:optOut.observedAt};
  assert.throws(()=>run([reserved,accepted,delivered,optOut,complaint]),/ambiguous/);
  assert.deepEqual(run([reserved,accepted,{...reserved}]),run([reserved,accepted]));
});

test("bounces, complaints and opt-outs remain suppressions",()=>{
  const events=["reserved","provider_accepted","recipient_opted_out",
    "provider_delivered","provider_complained"].map(evt);
  assert.deepEqual(run(events).suppression,["complained","opted_out"]);
  const bounced=run(["reserved","provider_accepted","provider_bounced"].map(evt));
  assert.equal(bounced.delivery,"bounced");
  assert.deepEqual(bounced.suppression,["bounced"]);
  assert.throws(()=>run([evt("recipient_opted_out"),evt("reserved",1)]),/Suppressed/);
});

test("opt-out after reservation prevents later new provider acceptance",()=>{
  const stopFirst=["reserved","recipient_opted_out","provider_accepted"].map(evt);
  assert.throws(()=>run(stopFirst),/provider acceptance after recipient stop-contact/);
  // A forged exact duplicate cannot hide the earlier stop before acceptance.
  assert.throws(()=>run([stopFirst[0],stopFirst[1],{...stopFirst[1]},stopFirst[2]]),
    /provider acceptance after recipient stop-contact/);
  assert.deepEqual(run(stopFirst.slice(0,2)).suppression,["opted_out"]);
});

test("late callback for a prior accepted dispatch retains stop-contact evidence",()=>{
  const accepted=["reserved","provider_accepted","recipient_opted_out",
    "provider_delivered","provider_complained"].map(evt);
  const result=run(accepted);
  assert.equal(result.delivery,"reported_delivered");
  assert.deepEqual(result.suppression,["complained","opted_out"]);
  assert.equal(result.state,"simulation-only");
  for(const claim of ["contactAuthorized","send","approved","deliveryAuthorized"])
    assert.equal(Object.hasOwn(result,claim),false);
});

test("cross-organization, recipient or revision dispatch keys are rejected",()=>{
  for(const altered of [
    {organizationId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
    {recipient:"other@example.test"},{idempotencyKey:"dryrun_"+"0".repeat(64)},
  ]){
    assert.throws(()=>run([{...evt("reserved"),...altered}]),/Invalid or cross-tenant/);
  }
  const next={...base,revision:4};
  assert.throws(()=>projectSimulatedDeliveryEvents(
    {...next,idempotencyKey:intent.idempotencyKey},[evt("reserved")]),/Invalid simulated delivery identity/);
});

test("malformed, accessor-backed and sparse events cannot enter the projection",()=>{
  for(const altered of [
    {eventId:"bad"},{observedAt:"2026-02-30T12:00:00.000Z"},
    {observedAt:"2026-10-20T08:00:00Z"},{kind:"sent"},{approved:true},
  ]){
    assert.throws(()=>run([{...evt("reserved"),...altered}]),/Invalid or cross-tenant/);
  }
  let accesses=0;
  const malicious=evt("reserved");
  Object.defineProperty(malicious,"kind",{enumerable:true,get(){
    accesses++;throw Error("getter executed");
  }});
  assert.throws(()=>run([malicious]),/Invalid or cross-tenant/);
  assert.equal(accesses,0);
  const hidden=[evt("reserved")];hidden[Symbol("approved")]=true;
  assert.throws(()=>run(hidden),/Invalid simulated delivery stream/);
  assert.throws(()=>run(new Array(1)),/Invalid simulated delivery stream/);
});

test("non-enumerable array events cannot hide contact observations from reviewers",()=>{
  const hidden=[evt("reserved")];
  Object.defineProperty(hidden,"0",{value:hidden[0],enumerable:false,configurable:true,writable:true});
  // A hidden indexed entry is not present in normal enumeration/JSON, even
  // though direct iteration would consume it as a delivery transition.
  assert.deepEqual(Object.keys(hidden),[]);
  assert.throws(()=>run(hidden),/Invalid simulated delivery stream/);
  let getterReads=0;
  const accessor=[evt("reserved")];
  Object.defineProperty(accessor,"0",{enumerable:true,configurable:true,get(){
    getterReads++;throw Error("getter should not run");
  }});
  assert.throws(()=>run(accessor),/Invalid simulated delivery stream/);
  assert.equal(getterReads,0);
  assert.equal(run([evt("reserved")]).delivery,"reserved");
});

test("empty evidence remains not started, not authorized",()=>{
  assert.deepEqual(run([]),{state:"simulation-only",delivery:"not_started",
    suppression:[],replied:false,eventCount:0,timeline:[]});
});
