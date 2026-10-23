import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {classifySimulatedDeliveryTriage} from "../lib/delivery-triage.ts";
const identity={organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
 proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:1,
 sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
 contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient:"buyer@fictional.example"};
const intent={...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
const at="2026-10-22T10:00:00.000Z";
const policy={consent:"confirmed",version:1,minimumDelayHours:24,maximumAttempts:2};
const event=(kind,index=0)=>({eventId:String(index+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
 organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
 recipient:intent.recipient,kind,
 observedAt:"2026-10-20T08:"+String(index).padStart(2,"0")+":00.000Z"});
const sent=["reserved","provider_accepted","provider_delivered"].map(event);
const evaluate=(events=sent,p=policy,time=at,rec=[],dealEvents=[])=>classifySimulatedDeliveryTriage(intent,events,p,rec,time,dealEvents);

test("internal timing eligibility remains external-authorization-required, never send",()=>{
 const outcome=evaluate();
 assert.equal(outcome.state,"review-simulation-only");
 assert.equal(outcome.category,"external-authorization-required");
 assert.equal(outcome.attention,"operator-review");
 assert.equal(outcome.sourceEventCount,3);
 for(const word of ["sendAllowed","authorized","approved","provider","customerId"])
   assert.equal(Object.hasOwn(outcome,word),false);
});
test("future delivery and recipient observations cannot be classified as current",()=>{
  const atNow="2026-10-22T10:00:00.000Z";
  const future="2026-10-22T10:00:00.001Z";
  const scenarios=[
    [event("reserved"),event("provider_accepted",1)],
    sent,
    ...["provider_bounced","recipient_opted_out",
      "provider_complained","recipient_replied"].map(kind=>
      [...sent,event(kind,3)]),
  ];
  for(const scenario of scenarios){
    const last=scenario.length-1;
    const futureEvents=scenario.map((e,i)=>i===last?{...e,observedAt:future}:e);
    const currentEvents=scenario.map((e,i)=>i===last?{...e,observedAt:atNow}:e);
    assert.throws(()=>evaluate(futureEvents),/Future simulated current-proposal triage observation/);
    const result=evaluate(currentEvents);
    assert.equal(result.state,"review-simulation-only");
    assert.ok(["contact-suppressed","reply-needs-review",
      "delivery-needs-verification","waiting-for-cooldown",
      "external-authorization-required"].includes(result.category));
  }
});

test("fictional opt-out, bounce, and complaint outrank other review categories",()=>{
 const cases=[
  [...sent,event("recipient_opted_out",3)],
  [event("reserved"),event("provider_accepted",1),event("provider_bounced",2)],
  [...sent,event("provider_complained",3)],
 ];
 for(const events of cases){
  const outcome=evaluate(events,{...policy,consent:"unknown"});
  assert.equal(outcome.category,"contact-suppressed");
  assert.equal(outcome.attention,"stop-contact");
 }
});
test("recipient response blocks follow-up even if otherwise due",()=>{
 const outcome=evaluate([...sent,event("recipient_replied",3)]);
 assert.equal(outcome.category,"reply-needs-review");
 assert.equal(outcome.attention,"operator-review");
});
test("unknown and revoked consent require verification even after fictional delivery",()=>{
 for(const consent of ["unknown","revoked"]){
  const outcome=evaluate(sent,{...policy,consent});
  assert.equal(outcome.category,"consent-needs-verification");
 }
});
test("missing accepted/delivered history requires provider verification",()=>{
 for(const events of [[],[event("reserved")],[event("reserved"),event("provider_accepted",1)]]){
  const outcome=evaluate(events);
  assert.equal(outcome.category,"delivery-needs-verification");
  assert.equal(outcome.state,"review-simulation-only");
 }
});
test("temporary cooldown and permanently exhausted attempt limit are distinct",()=>{
 const wait=evaluate(sent,policy,"2026-10-20T09:00:00.000Z");
 assert.equal(wait.category,"waiting-for-cooldown");
 assert.equal(wait.attention,"deferred");
 const attempt={attemptId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,recordedAt:"2026-10-21T10:00:00.000Z"};
 const capped={...policy,maximumAttempts:1};
 for(const when of [at,"2026-10-30T10:00:00.000Z"]){
   const result=evaluate(sent,capped,when,[attempt]);
   assert.equal(result.category,"follow-up-limit-reached");
   assert.equal(result.attention,"deferred");
   assert.match(result.rationale,/waiting longer cannot authorize/i);
   assert.equal(result.state,"review-simulation-only");
   assert.equal(Object.hasOwn(result,"contactAuthorized"),false);
 }
 assert.equal(evaluate(sent,policy,at,[attempt]).category,"external-authorization-required");
});
test("out-of-order, cross-tenant, or corrupted evidence cannot produce a triage result",()=>{
 assert.throws(()=>evaluate([event("provider_delivered")]),/Unexpected/);
 assert.throws(()=>evaluate([event("reserved",2),event("provider_accepted",1)]),/Out-of-order/);
 assert.throws(()=>evaluate([{...event("reserved"),
  organizationId:"ffffffff-ffff-4fff-8fff-ffffffffffff"}]),/cross-tenant/);
 assert.throws(()=>evaluate(sent,{...policy,maximumAttempts:10}),/Invalid simulated follow-up/);
});
test("duplicate replay stays deduplicated and side-effect-free",()=>{
 const results=evaluate([event("reserved"),{...event("reserved")},
  event("provider_accepted",1),event("provider_delivered",2)]);
 assert.equal(results.category,"external-authorization-required");
 assert.equal(results.sourceEventCount,3);
 assert.equal(evaluate().rationale,results.rationale);
});

test("won/lost outcomes are deferred, and stop-contact still outranks closed deals",()=>{
 const deal={eventId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  organizationId:intent.organizationId,proposalId:intent.proposalId,
  revision:intent.revision,kind:"won",observedAt:"2026-10-21T09:00:00.000Z"};
 const result=evaluate(sent,policy,at,[],[deal]);
 assert.equal(result.category,"deal-closed");
 assert.equal(result.attention,"deferred");
 assert.equal(result.state,"review-simulation-only");
 assert.equal(evaluate([...sent,event("recipient_opted_out",3)],policy,at,[],[deal]).category,
  "contact-suppressed");
 assert.equal(evaluate([...sent,event("recipient_replied",3)],policy,at,[],[deal]).category,
  "reply-needs-review");
 assert.equal(evaluate(sent,policy,at,[],[{...deal,kind:"lost"}]).category,"deal-closed");
});
