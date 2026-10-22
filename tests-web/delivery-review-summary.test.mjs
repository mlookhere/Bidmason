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
const recipientCase=(entry,recipient)=>{
  const {idempotencyKey: _unused,...identity}=entry.intent;
  const updated={...identity,recipient};
  const idempotencyKey=deliveryIdempotencyKey(updated);
  return {...entry,intent:{...updated,idempotencyKey},
    events:entry.events.map(event=>({...event,recipient,idempotencyKey})),
    previousAttempts:entry.previousAttempts.map(attempt=>({...attempt,recipient,idempotencyKey}))};
};

test("multiple fictional deliveries aggregate non-authoritative priorities without identifiers",()=>{
  const data=[make(0),make(1,["reserved","provider_accepted","provider_bounced"]),
    make(2,["reserved","provider_accepted","provider_delivered","recipient_replied"]),
    make(3,["reserved","provider_accepted","provider_delivered"],"unknown")]
    .map((entry,index)=>recipientCase(entry,`buyer-${index}@fictional.example`));
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
    "delivery-needs-verification","waiting-for-cooldown","deal-closed",
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

test("the same immutable proposal revision retains fingerprints across recipients",()=>{
  const first=make(0),alternate="second@fictional.example";
  const deliveryFor=(template,changes)=>{
    const {idempotencyKey: _old, ...original}=template.intent;
    const identity={...original,...changes};
    const idempotencyKey=deliveryIdempotencyKey(identity);
    return {...template,intent:{...identity,idempotencyKey},
      events:template.events.map(event=>({
        ...event,recipient:identity.recipient,idempotencyKey,
      }))};
  };
  const second=deliveryFor(make(1),{
    proposalId:first.intent.proposalId,recipient:alternate,
  });
  assert.equal(summary([first,second]).reviewedCases,2);
  for(const field of ["sourceSha256","policySha256","contentSha256","qaSha256"]){
    const changed=deliveryFor(make(1),{
      proposalId:first.intent.proposalId,recipient:alternate,[field]:"e".repeat(64),
    });
    for(const cases of [[first,changed],[changed,first]]){
      assert.throws(()=>summary(cases),
        /Conflicting synthetic CRM proposal revision across recipients/,field);
    }
  }
  const revised=deliveryFor(make(1),{
    proposalId:first.intent.proposalId,revision:2,recipient:alternate,
    contentSha256:"e".repeat(64),
  });
  assert.equal(summary([first,revised]).reviewedCases,2);
  // Other customers' proposal IDs are independent, even with different hashes.
  assert.equal(summary([first,deliveryFor(make(1),{
    recipient:alternate,contentSha256:"e".repeat(64),
  })]).reviewedCases,2);
});

test("shared fictional proposal revisions agree across historical recipients",()=>{
  const original=make(0),alternate="second@fictional.example";
  const clone=(template,changes)=>{
    const {idempotencyKey: _old,...rest}=template.intent;
    const identity={...rest,...changes};
    const idempotencyKey=deliveryIdempotencyKey(identity);
    return {intent:{...identity,idempotencyKey},events:template.events.map(event=>({
      ...event,recipient:identity.recipient,idempotencyKey,
    }))};
  };
  const second=clone(make(1),{recipient:alternate});
  const historical=make(4);
  const firstHistory={intent:historical.intent,events:historical.events};
  const sameRevision=clone(make(5),{
    proposalId:historical.intent.proposalId,revision:historical.intent.revision,
    recipient:alternate,
  });
  assert.equal(summarizeSyntheticDeliveryReview(org,[original,{...make(1),...second}],now,
    [[firstHistory],[sameRevision]]).reviewedCases,2);
  const changed=clone(make(5),{
    proposalId:historical.intent.proposalId,revision:historical.intent.revision,
    recipient:alternate,contentSha256:"e".repeat(64),
  });
  for(const [records,histories] of [
    [[original,{...make(1),...second}],[[firstHistory],[changed]]],
    [[{...make(1),...second},original],[[changed],[firstHistory]]],
  ]) assert.throws(()=>summarizeSyntheticDeliveryReview(org,records,now,histories),
    /Conflicting synthetic CRM proposal revision across recipients/);
  // The claim for a current revision is also immutable when reused as
  // another recipient's historical proposal with independent event IDs.
  const conflictedCurrent=clone(make(5),{
    proposalId:original.intent.proposalId,recipient:alternate,
    qaSha256:"e".repeat(64),
  });
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,
    [original,{...make(1),...second}],now,[[],[conflictedCurrent]]),
    /Conflicting synthetic CRM proposal revision across recipients/);
});

test("follow-up attempt IDs are unique across fictional proposals within a tenant",()=>{
  const id="22222222-2222-4222-8222-222222222222";
  const first=make(0),second=make(1);
  const withAttempt=(entry,attemptId,recordedAt="2026-10-21T09:00:00.000Z")=>({
    ...entry,previousAttempts:[{attemptId,organizationId:entry.intent.organizationId,
      idempotencyKey:entry.intent.idempotencyKey,recipient:entry.intent.recipient,
      recordedAt}],
  });
  const initial=withAttempt(first,id),colliding=withAttempt(second,id);
  for(const records of [[initial,colliding],[colliding,initial]]){
    assert.throws(()=>summary(records),/Cross-proposal simulated follow-up attempt ID collision/);
  }
  assert.equal(summary([initial,withAttempt(second,"33333333-3333-4333-8333-333333333333", "2026-10-21T10:00:00.000Z")]).reviewedCases,2);
  // An identical replay in one proposal is countable once and is not a
  // separate cross-proposal follow-up attempt.
  const replay={...initial,previousAttempts:[initial.previousAttempts[0],
    {...initial.previousAttempts[0]}]};
  assert.equal(summary([replay,second]).reviewedCases,2);
  const otherRecipient="other@fictional.example";
  const {idempotencyKey: _old,...fields}=second.intent;
  const recipientIntent={...fields,recipient:otherRecipient};
  const recipientKey=deliveryIdempotencyKey(recipientIntent);
  const recipientCase={...second,intent:{...recipientIntent,idempotencyKey:recipientKey},
    events:second.events.map(event=>({...event,recipient:otherRecipient,
      idempotencyKey:recipientKey}))};
  assert.throws(()=>summary([initial,withAttempt(recipientCase,id)]),
    /Cross-proposal simulated follow-up attempt ID collision/);
  // Only tenant-local reports are reconciled; the same synthetic ID in a
  // separately reviewed tenant is not a cross-tenant collision.
  const outside="99999999-9999-4999-8999-999999999999";
  const separate=withAttempt(make(1,undefined,"confirmed",outside),id);
  assert.equal(summarizeSyntheticDeliveryReview(outside,[separate],now).reviewedCases,1);
});

test("simultaneous same-recipient follow-ups on separate proposals are incoherent fictional audit history",()=>{
  const attempt=(entry,id,recordedAt="2026-10-21T09:00:00.000Z")=>({
    ...entry,previousAttempts:[{attemptId:id,
      organizationId:entry.intent.organizationId,
      idempotencyKey:entry.intent.idempotencyKey,
      recipient:entry.intent.recipient,recordedAt}],
  });
  const first=attempt(make(0),"11111111-1111-4111-8111-111111111111");
  const second=attempt(make(1),"22222222-2222-4222-8222-222222222222");
  for (const records of [[first,second],[second,first]]) {
    assert.throws(()=>summary(records),
      /Cross-proposal simulated recipient follow-up timestamp collision/);
  }
  // Different moments or different recipients are independent; we do not
  // invent an across-proposal company-wide minimum-delay rule.
  assert.equal(summary([first,attempt(make(1),
    "22222222-2222-4222-8222-222222222222","2026-10-21T10:00:00.000Z")]).reviewedCases,2);
  assert.equal(summary([first,attempt(recipientCase(make(1),"other@fictional.example"),
    "22222222-2222-4222-8222-222222222222")]).reviewedCases,2);
  const replay={...first,previousAttempts:[first.previousAttempts[0],
    {...first.previousAttempts[0]}]};
  assert.equal(summary([replay,make(1)]).reviewedCases,2);
  const otherTenant="99999999-9999-4999-8999-999999999999";
  assert.equal(summarizeSyntheticDeliveryReview(otherTenant,
    [attempt(make(1,undefined,"confirmed",otherTenant),
      "22222222-2222-4222-8222-222222222222")],now).reviewedCases,1);
});

test("recipient-wide stop-contact signals reconcile all reviewed fictional proposals",()=>{
  const clean=make(0),bounced=make(1,["reserved","provider_accepted","provider_bounced"]);
  const replied=make(2,["reserved","provider_accepted","provider_delivered","recipient_replied"]);
  for (const records of [[clean,bounced],[bounced,clean]]) {
    const result=summary(records);
    assert.deepEqual(result.attention,{stopContact:2,operatorReview:0,deferred:0});
    assert.equal(count(result,"contact-suppressed"),2);
    assert.equal(count(result,"external-authorization-required"),0);
  }
  for (const records of [[clean,replied],[replied,clean]]) {
    const result=summary(records);
    assert.deepEqual(result.attention,{stopContact:0,operatorReview:2,deferred:0});
    assert.equal(count(result,"reply-needs-review"),2);
    assert.equal(count(result,"contact-suppressed"),0);
  }
  for (const records of [[clean,bounced,replied],[replied,bounced,clean]]) {
    const result=summary(records);
    assert.deepEqual(result.attention,{stopContact:3,operatorReview:0,deferred:0});
    assert.equal(count(result,"contact-suppressed"),3);
    for (const value of [org,clean.intent.recipient,"dryrun_",clean.intent.proposalId])
      assert.equal(JSON.stringify(result).includes(value),false);
  }
  // Two distinct fictional recipients cannot suppress each other.
  const unrelated=recipientCase(bounced,"another@fictional.example");
  const separate=summary([clean,unrelated]);
  assert.equal(count(separate,"contact-suppressed"),1);
  assert.equal(count(separate,"external-authorization-required"),1);
});

test("historical stop-contact evidence propagates to same-recipient cases in CRM batch",()=>{
  const first=make(0),second=make(1);
  const earlier=make(4,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  const history={intent:earlier.intent,events:earlier.events};
  const result=summarizeSyntheticDeliveryReview(org,[first,second],now,[[history],[]]);
  assert.equal(count(result,"contact-suppressed"),2);
  assert.deepEqual(result.attention,{stopContact:2,operatorReview:0,deferred:0});
  const reversed=summarizeSyntheticDeliveryReview(org,[second,first],now,[[],[history]]);
  assert.deepEqual(result,reversed);
  const other=recipientCase(second,"another@fictional.example");
  const separate=summarizeSyntheticDeliveryReview(org,[first,other],now,[[history],[]]);
  assert.equal(count(separate,"contact-suppressed"),1);
  assert.equal(count(separate,"external-authorization-required"),1);
  const differentTenant="99999999-9999-4999-8999-999999999999";
  const outside=make(2,undefined,"confirmed",differentTenant);
  assert.equal(summarizeSyntheticDeliveryReview(differentTenant,[outside],now)
    .attention.stopContact,0);
});

test("known stop-contact events invalidate later cross-proposal follow-up attempts",()=>{
  const withAttempt=(entry,recordedAt)=>({...entry,previousAttempts:[{
    attemptId:"55555555-5555-4555-8555-555555555555",
    organizationId:entry.intent.organizationId,recipient:entry.intent.recipient,
    idempotencyKey:entry.intent.idempotencyKey,recordedAt,
  }]});
  const other=make(1),atStop="2026-10-22T08:03:00.000Z";
  for (const kind of ["recipient_replied","recipient_opted_out",
    "provider_bounced","provider_complained"]) {
    const stop=make(0,["reserved","provider_accepted","provider_delivered",kind]);
    const lateStop={...stop,events:stop.events.map((event,index)=>
      index===3?{...event,observedAt:atStop}:event)};
    for (const at of [atStop,"2026-10-22T08:03:00.001Z"]) {
      const attempted=withAttempt(other,at);
      for (const records of [[lateStop,attempted],[attempted,lateStop]]) {
        assert.throws(()=>summary(records),/Cross-proposal simulated follow-up attempt conflicts with contact-stop chronology/,kind);
      }
    }
    const earlier=withAttempt(other,"2026-10-21T09:00:00.000Z");
    const valid=summary([earlier,lateStop]);
    assert.equal(valid.reviewedCases,2);
    assert.equal(count(valid,kind==="recipient_replied"?"reply-needs-review":"contact-suppressed"),2);
  }
  const unrelated=recipientCase(other,"other@fictional.example");
  assert.equal(summary([make(0,["reserved","provider_accepted","provider_bounced"]),
    withAttempt(unrelated,"2026-10-22T08:03:00.000Z")]).reviewedCases,2);
});

test("historical contact stops also invalidate cross-proposal attempts without complete history",()=>{
  const first=make(0),second=make(1);
  const history=make(4,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  const historical={intent:history.intent,events:history.events};
  const attempted={...second,previousAttempts:[{
    attemptId:"66666666-6666-4666-8666-666666666666",
    organizationId:second.intent.organizationId,
    idempotencyKey:second.intent.idempotencyKey,recipient:second.intent.recipient,
    recordedAt:"2026-10-21T09:00:00.000Z",
  }]};
  for (const [records,histories] of [
    [[first,attempted],[[historical],[]]],
    [[attempted,first],[[],[historical]]],
  ]) assert.throws(()=>summarizeSyntheticDeliveryReview(org,records,now,histories),
    /Cross-proposal simulated follow-up attempt conflicts with contact-stop chronology/);
  // The same declared attempt is coherent if the prior event happened later.
  const lateHistorical={intent:history.intent,events:history.events.map((event,index)=>
    index===3?{...event,observedAt:"2026-10-22T09:00:00.000Z"}:event)};
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,attempted],now,
    [[lateHistorical],[]]).reviewedCases,2);
  const separate=recipientCase(attempted,"separate@fictional.example");
  assert.equal(summarizeSyntheticDeliveryReview(org,[first,separate],now,
    [[historical],[]]).reviewedCases,2);
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

test("won/lost CRM outcomes defer closed proposals without granting contact rights",()=>{
  const first=recipientCase(make(0),"first@fictional.example");
  const second=recipientCase(make(1),"second@fictional.example");
  const closure=(entry,kind,id)=>({
    eventId:id,organizationId:entry.intent.organizationId,
    proposalId:entry.intent.proposalId,revision:entry.intent.revision,
    kind,observedAt:"2026-10-21T12:00:00.000Z",
  });
  const a=closure(first,"won","11111111-1111-4111-8111-111111111111");
  const b=closure(second,"lost","22222222-2222-4222-8222-222222222222");
  const reviewed=summarizeSyntheticDeliveryReview(org,[first,second],now,
    undefined,[[a],[b]]);
  assert.equal(reviewed.state,"review-simulation-only");
  assert.equal(count(reviewed,"deal-closed"),2);
  assert.deepEqual(reviewed.attention,{stopContact:0,operatorReview:0,deferred:2});
  assert.equal(JSON.stringify(reviewed).includes("fictional.example"),false);
  assert.deepEqual(summarizeSyntheticDeliveryReview(org,[second,first],now,
    undefined,[[b],[a]]),reviewed);
  assert.equal(summarizeSyntheticDeliveryReview(org,[first],now,[[]],[[a]])
    .categories.find(x=>x.category==="deal-closed").count,1);
  const unverified=summary([first]);
  assert.equal(count(unverified,"deal-closed"),0);
  assert.equal(count(unverified,"external-authorization-required"),1);
});
test("closed-deal evidence cannot conceal opt-out or contradictory follow-up audit",()=>{
  const first=make(0,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  const closed={eventId:"33333333-3333-4333-8333-333333333333",
    organizationId:org,proposalId:first.intent.proposalId,revision:1,kind:"lost",
    observedAt:"2026-10-21T12:00:00.000Z"};
  const stopped=summarizeSyntheticDeliveryReview(org,[first],now,undefined,[[closed]]);
  assert.equal(count(stopped,"contact-suppressed"),1);
  assert.equal(count(stopped,"deal-closed"),0);
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first],now,undefined,[]),
    /Invalid synthetic deal-outcome review matrix/);
  const cross={...closed,organizationId:"ffffffff-ffff-4fff-8fff-ffffffffffff"};
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first],now,undefined,[[cross]]),
    /cross-tenant/);
  const conflicting={...closed,eventId:"44444444-4444-4444-8444-444444444444",kind:"won"};
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first],now,undefined,[[closed,conflicting]]),
    /Conflicting synthetic terminal/);
  const hidden=[[closed]];Object.defineProperty(hidden,"0",{enumerable:false});
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,[first],now,undefined,hidden),
    /Invalid synthetic deal-outcome review matrix/);
  const attempt={attemptId:"55555555-5555-4555-8555-555555555555",
    organizationId:org,idempotencyKey:first.intent.idempotencyKey,
    recipient:first.intent.recipient,recordedAt:"2026-10-22T08:00:00.000Z"};
  assert.throws(()=>summarizeSyntheticDeliveryReview(org,
    [{...make(0),previousAttempts:[attempt]}],now,undefined,[[closed]]),
    /closed-deal chronology/);
});
