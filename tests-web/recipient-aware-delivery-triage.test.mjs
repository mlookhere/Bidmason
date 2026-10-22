import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {classifySimulatedDeliveryTriage} from "../lib/delivery-triage.ts";
import {classifySimulatedRecipientAwareTriage} from "../lib/recipient-aware-delivery-triage.ts";
import {summarizeSyntheticDeliveryReview} from "../lib/delivery-review-summary.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTSIDE="99999999-9999-4999-8999-999999999999";
const EMAIL="buyer@fictional.example";
const NOW="2026-10-22T10:00:00.000Z";
const IDS=["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];
const POLICY={consent:"confirmed",version:1,minimumDelayHours:24,maximumAttempts:2};
function make(index,kinds=["reserved","provider_accepted","provider_delivered"],
    org=ORG,email=EMAIL,revision=2) {
  const identity={organizationId:org,proposalId:IDS[index],revision,
    sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
    contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient:email};
  const intent={...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
  const events=kinds.map((kind,i)=>({
    eventId:String(index*10+i+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId:org,idempotencyKey:intent.idempotencyKey,recipient:email,
    kind,observedAt:"2026-10-20T08:"+String(i).padStart(2,"0")+":00.000Z",
  }));
  return {intent,events,policy:POLICY,previousAttempts:[]};
}
const entry=make(0);
const past=(kind="recipient_opted_out")=>make(1,
  ["reserved","provider_accepted","provider_delivered",kind],ORG,EMAIL,1);
const triage=(current=entry,history=[],time=NOW)=>
  classifySimulatedRecipientAwareTriage(
    current.intent,current.events,current.policy,current.previousAttempts,history,time);
const summarize=(entries,history,now=NOW)=>
  summarizeSyntheticDeliveryReview(ORG,entries,now,history);

test("earlier recipient opt-out overrides internally eligible current proposal",()=>{
  assert.equal(classifySimulatedDeliveryTriage(
    entry.intent,entry.events,POLICY,[],NOW).category,"external-authorization-required");
  const review=triage(entry,[{intent:past().intent,events:past().events}]);
  assert.equal(review.category,"contact-suppressed");
  assert.equal(review.attention,"stop-contact");
  assert.deepEqual(review.historicalSuppression,["opted_out"]);
  assert.equal(review.historicalContact,"suppressed-in-fixtures");
  assert.equal(review.contactAuthorized,false);
  assert.equal(review.state,"review-simulation-only");
  assert.equal(review.sourceEventCount,3);
});


test("earlier reply puts a new due-looking proposal into manual reply review",()=>{
  const prior=past("recipient_replied");
  const historical=[{intent:prior.intent,events:prior.events}];
  const base=classifySimulatedDeliveryTriage(
    entry.intent,entry.events,POLICY,[],NOW);
  assert.equal(base.category,"external-authorization-required");
  const result=triage(entry,historical);
  assert.equal(result.category,"reply-needs-review");
  assert.equal(result.attention,"operator-review");
  assert.equal(result.historicalReplyObserved,true);
  assert.equal(result.historicalContact,"no-suppression-seen-in-fixtures");
  assert.deepEqual(result.historicalSuppression,[]);
  assert.equal(result.contactAuthorized,false);
  assert.match(result.rationale,/manual review/);
  const report=summarize([entry],[historical]);
  assert.equal(report.categories.find(x=>x.category==="reply-needs-review").count,1);
  assert.equal(report.categories.find(x=>x.category==="external-authorization-required").count,0);
  for(const forbidden of [EMAIL,ORG,"dryrun_",IDS[0]])
    assert.equal(JSON.stringify(report).includes(forbidden),false);
});
test("prior permanent suppression outranks a separate earlier reply",()=>{
  const reply=past("recipient_replied");
  const bounce=make(2,["reserved","provider_accepted","provider_bounced"],ORG,EMAIL,1);
  const result=triage(entry,[
    {intent:reply.intent,events:reply.events},
    {intent:bounce.intent,events:bounce.events},
  ]);
  assert.equal(result.category,"contact-suppressed");
  assert.equal(result.attention,"stop-contact");
  assert.deepEqual(result.historicalSuppression,["bounced"]);
  assert.equal(result.historicalReplyObserved,true);
  assert.equal(result.contactAuthorized,false);
});
test("individual triage rejects current reservations at or after historical stops",()=>{
  const old=past("recipient_opted_out");
  const historyAt=(stoppedAt)=>[{
    intent:old.intent,
    events:old.events.map((event,index)=>({...event,
      observedAt:index===3?stoppedAt:
        "2026-10-19T08:"+String(index).padStart(2,"0")+":00.000Z"})),
  }];
  for(const stop of ["2026-10-19T08:03:00.000Z",
    "2026-10-20T08:00:00.000Z"]){
    assert.throws(()=>triage(entry,historyAt(stop)),
      /Cross-proposal simulated reservation conflicts with contact-stop chronology/);
    assert.throws(()=>summarize([entry],[historyAt(stop)]),
      /Cross-proposal simulated reservation conflicts with contact-stop chronology/);
  }
  // An earlier reservation is coherent even when a late reply or opt-out
  // to the older proposal subsequently blocks follow-up on the new proposal.
  for(const stop of ["2026-10-20T08:00:00.001Z",
    "2026-10-21T08:03:00.000Z"]){
    const result=triage(entry,historyAt(stop));
    assert.equal(result.category,"contact-suppressed");
    assert.equal(result.attention,"stop-contact");
    assert.equal(result.contactAuthorized,false);
    assert.equal(summarize([entry],[historyAt(stop)]).reviewedCases,1);
  }
});

test("historical reservations cannot postdate a current reply or permanent stop",()=>{
  for(const kind of ["recipient_replied","recipient_opted_out",
    "provider_bounced","provider_complained"]){
    const current=make(0,kind==="provider_bounced"
      ?["reserved","provider_accepted","provider_bounced"]
      :["reserved","provider_accepted","provider_delivered",kind]);
    const stoppedAt=current.events.at(-1).observedAt;
    const old=make(1,["reserved","provider_accepted","provider_delivered"],
      ORG,EMAIL,1);
    const historyAt=(reservedAt)=>[{
      intent:old.intent,
      events:old.events.map((event,index)=>({...event,observedAt:index===0
        ?reservedAt:
        "2026-10-21T08:"+String(index).padStart(2,"0")+":00.000Z"})),
    }];
    for(const reservedAt of [stoppedAt,
      new Date(Date.parse(stoppedAt)+1).toISOString()]){
      assert.throws(()=>triage(current,historyAt(reservedAt)),
        /Cross-proposal simulated reservation conflicts with contact-stop chronology/,kind);
    }
    const earlier=new Date(Date.parse(stoppedAt)-1).toISOString();
    const valid=triage(current,historyAt(earlier));
    assert.equal(valid.category,kind==="recipient_replied"
      ?"reply-needs-review":"contact-suppressed",kind);
    assert.equal(valid.attention,kind==="recipient_replied"
      ?"operator-review":"stop-contact",kind);
    assert.equal(valid.contactAuthorized,false);
  }
});


test("individual triage and CRM reject follow-ups after a different proposal's stop",()=>{
  const current=make(0);
  const nextDayAttempt={
    attemptId:"77777777-7777-4777-8777-777777777777",
    organizationId:ORG,idempotencyKey:current.intent.idempotencyKey,
    recipient:EMAIL,recordedAt:"2026-10-21T08:02:00.000Z",
  };
  const withAttempt={...current,previousAttempts:[nextDayAttempt]};
  const diagnostic=/Cross-proposal simulated follow-up attempt conflicts with contact-stop chronology/;
  for(const kind of ["recipient_replied","recipient_opted_out",
    "provider_bounced","provider_complained"]){
    const prior=make(1,kind==="provider_bounced"
      ?["reserved","provider_accepted",kind]
      :["reserved","provider_accepted","provider_delivered",kind],
      ORG,EMAIL,1);
    const history=[{intent:prior.intent,events:prior.events}];
    // Within this proposal the attempt is timely; only the OTHER
    // proposal's earlier recipient stop makes the combined history invalid.
    assert.equal(classifySimulatedDeliveryTriage(current.intent,current.events,
      POLICY,[nextDayAttempt],NOW).state,"review-simulation-only");
    assert.throws(()=>triage(withAttempt,history),diagnostic,kind);
    assert.throws(()=>summarize([withAttempt],[history]),diagnostic,kind);
  }
});

test("historical stop and follow-up attempt boundary is inclusive without false positives",()=>{
  const current=make(0),prior=past("recipient_opted_out");
  const due="2026-10-21T08:02:00.000Z";
  const attempt={
    attemptId:"77777777-7777-4777-8777-777777777777",
    organizationId:ORG,idempotencyKey:current.intent.idempotencyKey,
    recipient:EMAIL,recordedAt:due,
  };
  const withAttempt={...current,previousAttempts:[attempt]};
  const at=(instant)=>[{intent:prior.intent,events:prior.events.map((event,index)=>({
    ...event,observedAt:index===3?instant:event.observedAt,
  }))}];
  for(const instant of [due,"2026-10-21T08:01:59.999Z"]){
    assert.throws(()=>triage(withAttempt,at(instant)),
      /Cross-proposal simulated follow-up attempt conflicts with contact-stop chronology/);
  }
  const laterStop=at("2026-10-21T08:02:00.001Z");
  const result=triage(withAttempt,laterStop);
  assert.equal(result.category,"contact-suppressed");
  assert.equal(result.contactAuthorized,false);
  const crm=summarize([withAttempt],[laterStop]);
  assert.equal(crm.attention.stopContact,1);
  assert.equal(crm.reviewedCases,1);
  assert.equal(triage(current,at(due)).contactAuthorized,false);
});

test("review and CRM reject hidden late reservations between two historical proposals",()=>{
  const stopped=past("recipient_opted_out");
  const later=make(2,["reserved","provider_accepted","provider_delivered"],
    ORG,EMAIL,1);
  const moved={intent:later.intent,events:later.events.map((event,index)=>({
    ...event,observedAt:"2026-10-20T09:0"+index+":00.000Z",
  }))};
  const earlier={intent:stopped.intent,events:stopped.events};
  const diagnostic=/Cross-proposal synthetic historical reservation conflicts with contact-stop chronology/;
  for(const history of [[earlier,moved],[moved,earlier]]){
    assert.throws(()=>triage(entry,history),diagnostic);
    assert.throws(()=>summarize([entry],[history]),diagnostic);
  }
});

test("current permanent stop-contact always outranks an earlier recipient reply",()=>{
  const prior=past("recipient_replied");
  const historical=[{intent:prior.intent,events:prior.events}];
  for(const kind of ["recipient_opted_out","provider_bounced","provider_complained"]){
    const kinds=kind==="provider_bounced"
      ?["reserved","provider_accepted","provider_bounced"]
      :["reserved","provider_accepted","provider_delivered",kind];
    const current=make(0,kinds);
    const result=triage(current,historical);
    assert.equal(result.category,"contact-suppressed",kind);
    assert.equal(result.attention,"stop-contact",kind);
    assert.equal(result.historicalReplyObserved,true,kind);
    assert.deepEqual(result.historicalSuppression,[],kind);
    assert.equal(result.historicalStreams,1,kind);
    assert.equal(result.contactAuthorized,false,kind);
    assert.match(result.rationale,/do not contact|stop contact/i);
    const aggregate=summarize([current],[historical]);
    assert.equal(aggregate.categories
      .find(x=>x.category==="contact-suppressed").count,1,kind);
    assert.equal(aggregate.attention.stopContact,1,kind);
  }
  // No current permanent stop: a historical reply still means human review.
  assert.equal(triage(entry,historical).category,"reply-needs-review");
});

test("historical reply and suppression cannot legitimize future current observations",()=>{
  const prior=past("recipient_replied");
  const history=[{intent:prior.intent,events:prior.events}];
  for(const kind of ["recipient_replied","recipient_opted_out",
    "provider_bounced","provider_complained"]){
    const current=make(0,kind==="provider_bounced"
      ?["reserved","provider_accepted","provider_bounced"]
      :["reserved","provider_accepted","provider_delivered",kind]);
    const future={...current,events:current.events.map((e,i)=>i===current.events.length-1
      ?{...e,observedAt:"2026-10-22T10:00:00.001Z"}:e)};
    assert.throws(()=>triage(future,history),
      /Future simulated current-proposal triage observation/,kind);
    assert.throws(()=>summarize([future],[history]),
      /Future simulated CRM current-stream observation/,kind);
  }
});

test("invalid prior reply or current event is never converted into a normal review",()=>{
  const reply=past("recipient_replied");
  const historical=[{intent:reply.intent,events:reply.events}];
  const invalid=make(0,["provider_delivered"]);
  assert.throws(()=>triage(invalid,historical),/Unexpected provider delivery/);
  const corrupted={intent:reply.intent,events:[...reply.events.slice(0,3),
    {...reply.events[3],organizationId:OUTSIDE}]};
  assert.throws(()=>triage(entry,[corrupted]),/cross-tenant delivery event/);
});

test("historical suppression outranks current replies, consent ambiguity, and cooldown",()=>{
  const history=[{intent:past().intent,events:past().events}];
  const replied=make(0,["reserved","provider_accepted","provider_delivered","recipient_replied"]);
  assert.equal(triage(replied,history).category,"contact-suppressed");
  const unknown={...entry,policy:{...POLICY,consent:"unknown"}};
  assert.equal(triage(unknown,history).attention,"stop-contact");
  assert.equal(triage(entry,history,"2026-10-20T09:00:00.000Z").category,
    "contact-suppressed");
});

test("empty or clean fictional history never upgrades to contact authorization",()=>{
  const clean=make(1,["reserved","provider_accepted","provider_delivered"],ORG,EMAIL,1);
  for(const history of [[],[{intent:clean.intent,events:clean.events}]]){
    const result=triage(entry,history);
    assert.equal(result.category,"external-authorization-required");
    assert.equal(result.contactAuthorized,false);
    assert.equal(result.historicalContact,"no-suppression-seen-in-fixtures");
    assert.deepEqual(result.historicalSuppression,[]);
    const fields=JSON.stringify(result);
    for(const secret of [EMAIL,ORG,entry.intent.idempotencyKey,entry.intent.proposalId])
      assert.equal(fields.includes(secret),false,"review accidentally returned identifiers");
  }
});

test("historical bounce plus complaint aggregate into one stop-contact case",()=>{
  const bounced=make(1,["reserved","provider_accepted","provider_bounced"],ORG,EMAIL,1);
  const complained=make(2,["reserved","provider_accepted","provider_delivered",
    "provider_complained"],ORG,EMAIL,1);
  const other=make(3);
  const history=[[{intent:bounced.intent,events:bounced.events},
    {intent:complained.intent,events:complained.events}],[]];
  const report=summarize([entry,other],history);
  assert.equal(report.reviewedCases,2);
  assert.deepEqual(report.attention,{stopContact:2,operatorReview:0,deferred:0});
  assert.equal(report.categories.find(x=>x.category==="contact-suppressed").count,2);
  assert.equal(report.categories.find(x=>x.category==="external-authorization-required").count,0);
  const json=JSON.stringify(report);
  for(const forbidden of [EMAIL,ORG,"dryrun_",IDS[0],"provider_accepted"])
    assert.equal(json.includes(forbidden),false);
});

test("original summary behavior is preserved if caller omits history matrix",()=>{
  const old=summarizeSyntheticDeliveryReview(ORG,[entry],NOW);
  const clean=summarize([entry],[[]]);
  assert.deepEqual(clean,old);
  assert.equal(old.categories.find(x=>x.category==="external-authorization-required").count,1);
  assert.equal(old.attention.operatorReview,1);
});

test("partial, sparse, decorated and misaligned history matrices fail closed",()=>{
  for(const history of [[],[[],[]],new Array(1)]){
    assert.throws(()=>summarize([entry],history),/Invalid recipient history matrix/);
  }
  const decorated=[[]];decorated[Symbol("ignored")]=true;
  assert.throws(()=>summarize([entry],decorated),/Invalid recipient history matrix/);
  const hostile=[[]];let reads=0;
  Object.defineProperty(hostile,"0",{enumerable:true,get(){reads++;throw Error("getter")}});
  assert.throws(()=>summarize([entry],hostile),/Invalid recipient history matrix/);
  assert.equal(reads,0);
});

test("cross-tenant, cross-recipient, and current proposal history are never silently ignored",()=>{
  const cross=make(1,["reserved"],OUTSIDE,EMAIL,1);
  const wrong=make(1,["reserved"],ORG,"someone@fictional.example",1);
  const same=make(0);
  for(const bad of [cross,wrong,same]){
    assert.throws(()=>triage(entry,[{intent:bad.intent,events:bad.events}]),
      /Cross-tenant or cross-recipient|Duplicate or current-proposal/);
    assert.throws(()=>summarize([entry],[[{intent:bad.intent,events:bad.events}]]),
      /Cross-tenant or cross-recipient|Duplicate or current-proposal/);
  }
});

test("malformed history and fake current evidence cannot be converted into a valid review",()=>{
  const valid=past();
  const contaminated={...valid.events[1],recipient:"outside@fictional.example"};
  assert.throws(()=>triage(entry,[{intent:valid.intent,events:[
    valid.events[0],contaminated,...valid.events.slice(2)]}]),/cross-tenant|mismatched/i);
  assert.throws(()=>triage(make(0,["provider_delivered"]),[
    {intent:valid.intent,events:valid.events}]),/Unexpected provider delivery/);
  assert.throws(()=>triage(entry,new Array(1)),/Invalid synthetic recipient history/);
  assert.throws(()=>summarize([entry],[[{...valid,allowedToSend:true}]]),
    /Invalid synthetic recipient history record/);
});

test("duplicate case identities still fail when full recipient history supplied",()=>{
  assert.throws(()=>summarize([entry,{...entry}],[[],[]]),
    /Duplicate simulated review identity/);
  const first=past();
  assert.throws(()=>triage(entry,[
    {intent:first.intent,events:first.events},{intent:first.intent,events:first.events}
  ]),/Duplicate or current-proposal/);
});

const asHistory = ({intent,events}) => ({intent,events});

test("individual triage rejects cross-proposal event ID reuse even without contact-stop events",()=>{
  const current=make(0);
  const prior=make(1,["reserved","provider_accepted","provider_delivered"],ORG,EMAIL,1);
  for(const currentIndex of [0,1,2]){
    for(const historicalIndex of [0,1,2]){
      const colliding={intent:prior.intent,events:prior.events.map((event,i)=>
        i===historicalIndex?{...event,eventId:current.events[currentIndex].eventId}:event)};
      const history=[colliding];
      assert.throws(()=>triage(current,history),
        /Cross-proposal simulated recipient event ID collision/,
        "current "+currentIndex+" versus historical "+historicalIndex);
      assert.throws(()=>summarize([current],[history]),
        /Conflicting synthetic CRM event ID across streams/);
    }
  }
  const cleanHistory=[asHistory(prior)];
  const allowed=triage(current,cleanHistory);
  assert.equal(allowed.state,"review-simulation-only");
  assert.equal(allowed.historicalStreams,1);
  assert.equal(allowed.contactAuthorized,false);
  assert.equal(summarize([current],[cleanHistory]).reviewedCases,1);
});

test("historical reply and permanent suppression cannot hide a reused current event ID",()=>{
  const current=make(0);
  for(const kind of ["recipient_replied","recipient_opted_out",
    "provider_bounced","provider_complained"]){
    const historySource=make(1,kind==="provider_bounced"
      ?["reserved","provider_accepted","provider_bounced"]
      :["reserved","provider_accepted","provider_delivered",kind],
      ORG,EMAIL,1);
    const changed=asHistory({...historySource,events:historySource.events.map((event,i)=>
      i===1?{...event,eventId:current.events[1].eventId}:event)});
    assert.throws(()=>triage(current,[changed]),
      /Cross-proposal simulated recipient event ID collision/,kind);
  }
});

test("CRM rollups reject event IDs reused across current and historical streams",()=>{
  const current=make(0),other=make(2);
  const prior=make(1,["reserved","provider_accepted","provider_delivered"],ORG,EMAIL,1);
  const colliding={...prior,events:prior.events.map((event,i)=>i===0
    ?{...event,eventId:current.events[0].eventId}:event)};
  assert.throws(()=>summarize([current,other],[[asHistory(colliding)],[]]),
    /Conflicting synthetic CRM event ID across streams/);
  assert.throws(()=>summarize([other,current],[[],[asHistory(colliding)]]),
    /Conflicting synthetic CRM event ID across streams/);
  assert.equal(summarize([current,other],[[asHistory(prior)],[]]).reviewedCases,2);
});

test("CRM rollups detect conflicting historical event IDs while accepting shared exact history",()=>{
  const first=make(0),second=make(2);
  const prior=make(1,["reserved","provider_accepted","provider_delivered"],ORG,EMAIL,1);
  const changed={...prior,events:prior.events.map((event,i)=>i===1
    ?{...event,observedAt:"2026-10-20T08:01:01.000Z"}:event)};
  assert.equal(summarize([first,second],[[asHistory(prior)],[asHistory(prior)]]).reviewedCases,2);
  assert.throws(()=>summarize([first,second],[[asHistory(prior)],[asHistory(changed)]]),
    /Conflicting synthetic CRM event ID across streams/);
  assert.throws(()=>summarize([second,first],[[asHistory(changed)],[asHistory(prior)]]),
    /Conflicting synthetic CRM event ID across streams/);

  const otherRecipient="other@fictional.example";
  const secondRecipient=make(2,undefined,ORG,otherRecipient);
  const otherHistory=make(3,["reserved","provider_accepted","provider_delivered"],ORG,otherRecipient,1);
  const collision={...otherHistory,events:otherHistory.events.map((event,i)=>i===0
    ?{...event,eventId:prior.events[0].eventId}:event)};
  assert.throws(()=>summarize([first,secondRecipient],[[asHistory(prior)],[asHistory(collision)]]),
    /Conflicting synthetic CRM event ID across streams/);
  assert.equal(summarize([first,secondRecipient],[[asHistory(prior)],[asHistory(otherHistory)]]).reviewedCases,2);
});
