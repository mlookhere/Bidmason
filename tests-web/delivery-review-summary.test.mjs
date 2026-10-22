import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {summarizeSyntheticDeliveryReview} from "../lib/delivery-review-summary.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposalIds=[
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "11111111-1111-4111-8111-111111111111",
];
const now="2026-10-22T10:00:00.000Z";
const policy={consent:"confirmed",version:1,minimumDelayHours:24,maximumAttempts:2};
const make=(index,kinds=["reserved","provider_accepted","provider_delivered"],consent="confirmed",organizationId=org)=>{
  const identity={organizationId,proposalId:proposalIds[index],revision:1,
    sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
    contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),
    recipient:"buyer@fictional.example"};
  const intent={...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
  const events=kinds.map((kind,j)=>({eventId:String(index*10+j+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId,recipient:intent.recipient,idempotencyKey:intent.idempotencyKey,
    kind,observedAt:"2026-10-20T08:"+String(j).padStart(2,"0")+":00.000Z"}));
  return {intent,events,policy:{...policy,consent},previousAttempts:[]};
};
const summary=(records,time=now)=>summarizeSyntheticDeliveryReview(org,records,time);
const count=(s,kind)=>s.categories.find(x=>x.category===kind).count;

test("multiple fictional deliveries aggregate non-authoritative priorities without identifiers",()=>{
  const data=[make(0),make(1,["reserved","provider_accepted","provider_bounced"]),
    make(2,["reserved","provider_accepted","provider_delivered","recipient_replied"]),
    make(3,["reserved","provider_accepted","provider_delivered"],"unknown")];
  const result=summary(data);
  assert.equal(result.state,"review-simulation-only");
  assert.equal(result.reviewedCases,4);
  assert.deepEqual(result.attention,{stopContact:1,operatorReview:3,deferred:0});
  assert.equal(count(result,"contact-suppressed"),1);
  assert.equal(count(result,"reply-needs-review"),1);
  assert.equal(count(result,"consent-needs-verification"),1);
  assert.equal(count(result,"external-authorization-required"),1);
  assert.equal(result.categories.reduce((n,c)=>n+c.count,0),4);
  const json=JSON.stringify(result);
  for(const forbidden of ["fictional.example","dryrun_","organizationId","recipient","proposalId","approved","sendAllowed"])
    assert.equal(json.includes(forbidden),false,forbidden);
});
test("category order and totals are stable under permutations",()=>{
  const cases=[make(0),make(1,["reserved","provider_accepted","provider_bounced"]),
    make(2,["reserved","provider_accepted","provider_delivered","recipient_replied"])];
  const a=summary(cases);
  const b=summary([...cases].reverse());
  assert.deepEqual(a,b);
  assert.deepEqual(a.categories.map(c=>c.category),[
    "contact-suppressed","reply-needs-review","consent-needs-verification",
    "delivery-needs-verification","waiting-for-cooldown",
    "external-authorization-required"]);
});
test("cross-tenant cases fail even when internally consistent",()=>{
  const external=make(0,["reserved"],"confirmed",
    "99999999-9999-4999-8999-999999999999");
  assert.throws(()=>summary([external]),/Cross-tenant/);
  assert.throws(()=>summarizeSyntheticDeliveryReview("invalid",[make(0)],now),/Invalid simulated review batch/);
});
test("duplicate delivery identity rejects both identical and conflicting entries",()=>{
  const valid=make(0);
  assert.throws(()=>summary([valid,{...valid}]),/Duplicate simulated review identity/);
  assert.throws(()=>summary([valid,{...valid,policy:{...valid.policy,consent:"revoked"}}]),
    /Duplicate simulated review identity/);
});
test("same proposal revision and recipient cannot be re-keyed with contradictory evidence",()=>{
  const initial=make(0),other=make(1);
  for(const field of ["sourceSha256","policySha256","contentSha256","qaSha256"]){
    const {idempotencyKey: _previous,...raw}=initial.intent;
    const modified={...raw,[field]:"e".repeat(64)};
    const changed={...other,intent:{...modified,
      idempotencyKey:deliveryIdempotencyKey(modified)},
      events:other.events.map(event=>({...event,
        idempotencyKey:deliveryIdempotencyKey(modified)}))};
    assert.throws(()=>summary([initial,changed]),
      /Conflicting simulated proposal revision/,field);
    assert.throws(()=>summary([changed,initial]),
      /Conflicting simulated proposal revision/,field);
  }
  // Revisions are independent; delivering the exact same revision to a
  // different fictional recipient is not inherently a duplicate.
  const clone=(changes,template=other)=>{
    const {idempotencyKey: _old,...raw}=initial.intent;
    const modified={...raw,...changes};
    const idempotencyKey=deliveryIdempotencyKey(modified);
    return {...template,intent:{...modified,idempotencyKey},
      events:template.events.map(event=>({...event,
        recipient:modified.recipient,idempotencyKey}))};
  };
  assert.equal(summary([initial,clone({revision:2})]).reviewedCases,2);
  assert.equal(summary([initial,clone({recipient:"other@fictional.example"})]).reviewedCases,2);
  assert.equal(summary([initial,other]).reviewedCases,2);
});

test("event IDs must not collide between distinct proposals in one tenant",()=>{
  const first=make(0),second=make(1);
  const collision={...second,events:second.events.map((e,i)=>i===1
    ?{...e,eventId:first.events[1].eventId}:e)};
  assert.throws(()=>summary([first,collision]),/Cross-proposal simulated review event ID collision/);
  assert.throws(()=>summary([collision,first]),/Cross-proposal simulated review event ID collision/);
  assert.equal(summary([first,second]).reviewedCases,2);
  const replay={...first,events:[...first.events,{...first.events[0]}]};
  assert.equal(summary([replay,second]).reviewedCases,2);
  const otherTenant=make(1,["reserved"],"confirmed",
    "99999999-9999-4999-8999-999999999999");
  assert.equal(summarizeSyntheticDeliveryReview(otherTenant.intent.organizationId,
    [otherTenant],now).reviewedCases,1);
});

test("historical event IDs agree with current and repeated history claims",()=>{
  const first=make(0),second=make(1),older=make(4);
  const history={intent:older.intent,events:older.events};
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[history],[history]]).reviewedCases,2);
  const collision=make(5);
  const altered={intent:collision.intent,events:collision.events.map((event,i)=>
    i===1?{...event,eventId:older.events[1].eventId}:event)};
  for (const historyMatrix of [[[history],[altered]],[[altered],[history]]]){
    assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first,second],now,
      historyMatrix),/Conflicting synthetic CRM event ID across streams/);
  }
  const currentCollision={...history,events:history.events.map((event,i)=>
    i===0?{...event,eventId:first.events[0].eventId}:event)};
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[],[currentCollision]]),/Conflicting synthetic CRM event ID across streams/);
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[],[{intent:first.intent,events:first.events}]]).reviewedCases,2);
  const changed={...history,events:history.events.map((event,i)=>
    i===2?{...event,observedAt:"2026-10-20T08:03:00.000Z"}:event)};
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[history],[changed]]),/Conflicting synthetic CRM event ID across streams/);
});

test("historical proposal revisions cannot silently change fingerprints across cases",()=>{
  const first=make(0),second=make(1),earlier=make(4);
  const asHistory=({intent,events})=>({intent,events});
  const {idempotencyKey: _earlierKey, ...earlierFields}=earlier.intent;
  const alteredIdentity={...earlierFields,sourceSha256:"e".repeat(64)};
  const alteredKey=deliveryIdempotencyKey(alteredIdentity);
  const altered={intent:{...alteredIdentity,idempotencyKey:alteredKey},
    events:make(5).events.map(event=>({...event,idempotencyKey:alteredKey}))};
  for(const matrix of [[[asHistory(earlier)],[altered]],[[altered],[asHistory(earlier)]]]){
    assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first,second],now,matrix),
      /Conflicting synthetic CRM revision across streams/);
  }
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[asHistory(earlier)],[asHistory(earlier)]]).reviewedCases,2);
  // The same exact proposal revision is allowed in another review's history.
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[],[asHistory(first)]]).reviewedCases,2);
  // An altered copy of a current revision is invalid as earlier evidence.
  const {idempotencyKey: _firstKey, ...currentFields}=first.intent;
  const modifiedCurrent={...currentFields,qaSha256:"e".repeat(64)};
  const currentKey=deliveryIdempotencyKey(modifiedCurrent);
  const conflicting={intent:{...modifiedCurrent,idempotencyKey:currentKey},
    events:make(5).events.map(event=>({...event,idempotencyKey:currentKey}))};
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[],[conflicting]]),/Conflicting synthetic CRM revision across streams/);
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[second,first],now,
    [[conflicting],[]]),/Conflicting synthetic CRM revision across streams/);
  // An actual distinct revision with fresh event IDs is not a contradiction.
  const nextRevision={...earlierFields,revision:2};
  const newKey=deliveryIdempotencyKey(nextRevision);
  const validRevision={intent:{...nextRevision,idempotencyKey:newKey},
    events:make(5).events.map(event=>({...event,idempotencyKey:newKey}))};
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,second],now,
    [[asHistory(earlier)],[validRevision]]).reviewedCases,2);
});

test("empty, oversized, sparse and decorated collections are rejected",()=>{
  for(const entries of [[],Array(101).fill(make(0)),new Array(1)]){
    assert.throws(()=>summary(entries),/Invalid simulated review batch/);
  }
  const marked=[make(0)];
  marked[Symbol("hidden")]="approve";
  assert.throws(()=>summary(marked),/Invalid simulated review batch/);
});
test("hidden entry flags, unusual prototypes and accessors fail before reading getters",()=>{
  const extra={...make(0),send:true};
  assert.throws(()=>summary([extra]),/Invalid simulated review entry/);
  assert.throws(()=>summary([Object.assign(Object.create(null),make(0))]),/Invalid simulated review entry/);
  let called=0;const accessor={...make(0)};
  Object.defineProperty(accessor,"intent",{enumerable:true,get(){called++;throw Error("getter");}});
  assert.throws(()=>summary([accessor]),/Invalid simulated review entry/);
  assert.equal(called,0);
});
test("invalid timeline, consent, history, and timestamp cannot become counts",()=>{
  assert.throws(()=>summary([make(0,["provider_delivered"])]),/Unexpected provider delivery/);
  const bad=make(0);
  assert.throws(()=>summary([{...bad,policy:{...policy,maximumAttempts:7}}]),
    /Invalid simulated follow-up inputs/);
  assert.throws(()=>summary([bad],"2026-10-22"),/Invalid simulated follow-up inputs/);
  assert.throws(()=>summary([{...bad,events:[{...bad.events[0],
    organizationId:"99999999-9999-4999-8999-999999999999"}]}]),/cross-tenant/);
});
test("cooldown and incomplete fictional delivery are counted but never marked actionable",()=>{
  const result=summary([make(0),make(1,["reserved"]),make(2)],"2026-10-20T09:00:00.000Z");
  assert.equal(count(result,"waiting-for-cooldown"),2);
  assert.equal(count(result,"delivery-needs-verification"),1);
  assert.deepEqual(result.attention,{stopContact:0,operatorReview:1,deferred:2});
  assert.ok(!Object.hasOwn(result,"send"));
  assert.ok(!Object.hasOwn(result,"queue"));
});
