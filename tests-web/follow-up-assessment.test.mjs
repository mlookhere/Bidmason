import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {assessSimulatedFollowUp} from "../lib/follow-up-assessment.ts";

const identity={organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:3,
  sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient:"buyer@example.test"};
const intent={...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
const evt=(kind,i=0)=>({eventId:String(i+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind,observedAt:"2026-10-20T08:"+
    String(i).padStart(2,"0")+":00.000Z"});
const attempt=(i=0)=>({attemptId:String(i+1).padStart(8,"0")+"-cccc-4ccc-8ccc-cccccccccccc",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,recordedAt:"2026-10-22T08:"+
    String(i).padStart(2,"0")+":00.000Z"});
const delivered=["reserved","provider_accepted","provider_delivered"].map(evt);
const policy={consent:"confirmed",version:1,minimumDelayHours:24,maximumAttempts:2};
const run=(o={})=>assessSimulatedFollowUp(o.intent??intent,o.events??delivered,
  o.policy??policy,o.attempts??[],o.now??"2026-10-23T12:00:00.000Z");

test("due candidate remains internal only, without send authority",()=>{
  const result=run();
  assert.equal(result.state,"candidate-internal-only");
  assert.equal(result.nextEligibleAt,"2026-10-21T08:02:00.000Z");
  assert.deepEqual(result.blockers,[]);
  for(const field of ["send","approved","authorized","provider"])assert.equal(Object.hasOwn(result,field),false);
});
test("consent, reply, opt-out, complaint and bounce each block",()=>{
  for(const consent of ["unknown","revoked"])
    assert.equal(run({policy:{...policy,consent}}).state,"blocked");
  for(const kind of ["recipient_replied","recipient_opted_out","provider_complained","provider_bounced"])
    assert.equal(run({events:[...delivered,evt(kind,3)]}).state,"blocked",kind);
});
test("incomplete delivery, future observations and cooldown do not become candidates",()=>{
  for(const events of [[],[evt("reserved")],[evt("reserved"),evt("provider_accepted",1)]]){
    const result=run({events});
    assert.equal(result.state,"blocked");
    assert.equal(result.nextEligibleAt,null);
  }
  for(const now of ["2026-10-20T07:00:00.000Z","2026-10-20T09:00:00.000Z"])
    assert.equal(run({now}).state,"blocked");
  assert.equal(run({now:"2026-10-21T08:02:00.000Z"}).state,"candidate-internal-only");
});
test("follow-up history enforces delay, limits and identical idempotent replays",()=>{
  const first=attempt(0),second=attempt(1);
  assert.equal(run({attempts:[first],now:"2026-10-22T09:00:00.000Z"}).state,"blocked");
  assert.equal(run({attempts:[first],now:"2026-10-23T08:00:00.000Z"}).state,"candidate-internal-only");
  const exhausted=run({attempts:[first,second]});
  assert.equal(exhausted.state,"blocked");
  assert.ok(exhausted.blockers.includes("Follow-up attempt limit reached"));
  assert.equal(run({attempts:[first,{...first}]}).recordedAttempts,1);
});
test("cross-tenant, inconsistent replay, forged and out-of-order attempts are refused",()=>{
  const first=attempt(0),second=attempt(1);
  for(const change of [
    {organizationId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
    {recipient:"other@example.test"},{idempotencyKey:"dryrun_"+"0".repeat(64)},
    {recordedAt:"2026-02-30T08:00:00.000Z"},{attemptId:"invalid"},{approved:true},
  ])assert.throws(()=>run({attempts:[{...first,...change}]}),/Invalid or cross-tenant/);
  assert.throws(()=>run({attempts:[first,{...first,recordedAt:second.recordedAt}]}),/Conflicting/);
  assert.throws(()=>run({attempts:[second,first]}),/chronological/);
  assert.throws(()=>run({attempts:[{...first,recordedAt:"2026-10-19T08:00:00.000Z"}]}),/chronological/);
  const changed={...identity,revision:4};
  assert.throws(()=>run({intent:{...changed,idempotencyKey:intent.idempotencyKey}}),/Invalid simulated delivery identity/);
});
test("unsafe policy, accessor fields, malformed time and sparse arrays fail closed",()=>{
  for(const change of [
    {minimumDelayHours:0},{minimumDelayHours:721},{minimumDelayHours:1.5},
    {maximumAttempts:0},{maximumAttempts:4},{version:0},{consent:"implied"},{approved:true}
  ])assert.throws(()=>run({policy:{...policy,...change}}),/Invalid simulated follow-up inputs/);
  for(const now of ["2026-10-20T08:00:00Z","yesterday","2026-02-30T08:00:00.000Z"])
    assert.throws(()=>run({now}),/Invalid simulated follow-up inputs/);
  assert.throws(()=>run({attempts:new Array(1)}),/Invalid simulated follow-up inputs/);
  let reads=0;const hostile={...policy};
  Object.defineProperty(hostile,"consent",{enumerable:true,get(){reads++;throw Error("getter")}});
  assert.throws(()=>run({policy:hostile}),/Invalid simulated follow-up inputs/);
  assert.equal(reads,0);
});
test("forged events and accessor-backed attempt entries cannot become ready",()=>{
  assert.throws(()=>run({events:[evt("provider_delivered")]}),/Unexpected/);
  assert.throws(()=>run({events:[evt("reserved",3),evt("provider_accepted",2)]}),/Out-of-order/);
  const bad={...attempt()};
  Object.defineProperty(bad,"recordedAt",{enumerable:true,get(){throw Error("getter")}});
  assert.throws(()=>run({attempts:[bad]}),/Invalid or cross-tenant/);
});
