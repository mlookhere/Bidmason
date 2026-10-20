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

test("bounces, complaints and opt-outs remain suppressions",()=>{
  const events=["reserved","provider_accepted","recipient_opted_out",
    "provider_delivered","provider_complained"].map(evt);
  assert.deepEqual(run(events).suppression,["complained","opted_out"]);
  const bounced=run(["reserved","provider_accepted","provider_bounced"].map(evt));
  assert.equal(bounced.delivery,"bounced");
  assert.deepEqual(bounced.suppression,["bounced"]);
  assert.throws(()=>run([evt("recipient_opted_out"),evt("reserved",1)]),/Suppressed/);
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

test("empty evidence remains not started, not authorized",()=>{
  assert.deepEqual(run([]),{state:"simulation-only",delivery:"not_started",
    suppression:[],replied:false,eventCount:0,timeline:[]});
});
