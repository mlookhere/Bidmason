import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {assessSimulatedFollowUp} from "../lib/follow-up-assessment.ts";
import {reviewSimulatedRecipientContactHistory} from "../lib/recipient-suppression-history.ts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "99999999-9999-4999-8999-999999999999";
const RECIPIENT = "buyer@fictional.example";
const AT = "2026-10-22T10:00:00.000Z";
const IDS = ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "ffffffff-ffff-4fff-8fff-ffffffffffff"];
const identity=(n=0,org=ORG,recipient=RECIPIENT,revision=1)=>{
  const raw={organizationId:org,proposalId:IDS[n],revision,
    sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
    contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient};
  return {...raw,idempotencyKey:deliveryIdempotencyKey(raw)};
};
const target=identity(0,ORG,RECIPIENT,2);
const make=(n,kinds,org=ORG,recipient=RECIPIENT,revision=1)=>{
  const intent=identity(n,org,recipient,revision);
  const events=kinds.map((kind,i)=>({
    eventId:String(n*10+i+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId:org,recipient,idempotencyKey:intent.idempotencyKey,kind,
    observedAt:"2026-10-20T08:"+String(i).padStart(2,"0")+":00.000Z",
  }));
  return {intent,events};
};
const scan=(history,time=AT,goal=target)=>reviewSimulatedRecipientContactHistory(goal,history,time);
const delivered=()=>make(1,["reserved","provider_accepted","provider_delivered"]);

test("historic opt-out prevents a clean new proposal from establishing contact clearance",()=>{
  const past=make(1,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  const newProposal=make(0,["reserved","provider_accepted","provider_delivered"],ORG,RECIPIENT,2);
  const due=assessSimulatedFollowUp(newProposal.intent,newProposal.events,
    {consent:"confirmed",version:1,minimumDelayHours:24,maximumAttempts:1},[],AT);
  assert.equal(due.state,"candidate-internal-only");
  const result=scan([past],AT,newProposal.intent);
  assert.equal(result.contact,"suppressed-in-fixtures");
  assert.deepEqual(result.suppression,["opted_out"]);
  assert.equal(result.contactAuthorized,false);
  assert.equal(result.state,"review-simulation-only");
  for(const word of ["recipient","organizationId","idempotencyKey","proposalId","sendAllowed"])
    assert.equal(Object.hasOwn(result,word),false);
});

test("an earlier reply is recorded for manual review, not treated as a permanent opt-out",()=>{
  const previous=make(1,["reserved","provider_accepted","provider_delivered","recipient_replied"]);
  const out=scan([previous]);
  assert.equal(out.contact,"no-suppression-seen-in-fixtures");
  assert.deepEqual(out.suppression,[]);
  assert.equal(out.repliedInHistory,true);
  assert.equal(out.contactAuthorized,false);
  const serialized=JSON.stringify(out);
  for(const secret of [RECIPIENT,ORG,target.idempotencyKey,target.proposalId])
    assert.equal(serialized.includes(secret),false);
  assert.equal(scan([]).repliedInHistory,false);
  assert.equal(scan([delivered()]).repliedInHistory,false);
});
test("historical replies coexist with sticky suppression irrespective of proposal order",()=>{
  const replied=make(1,["reserved","provider_accepted","provider_delivered","recipient_replied"]);
  const bounced=make(2,["reserved","provider_accepted","provider_bounced"]);
  const a=scan([replied,bounced]);
  assert.deepEqual(a.suppression,["bounced"]);
  assert.equal(a.contact,"suppressed-in-fixtures");
  assert.equal(a.repliedInHistory,true);
  assert.deepEqual(a,scan([bounced,replied]));
});
test("bad prior reply evidence fails rather than silently dropping the manual review hold",()=>{
  const replied=make(1,["reserved","provider_accepted","provider_delivered","recipient_replied"]);
  const broken={...replied,events:replied.events.map((item,index)=>index===3
    ?{...item,recipient:"someone-else@fictional.example"}:item)};
  assert.throws(()=>scan([broken]),/cross-tenant delivery event/);
  assert.throws(()=>scan([replied],"2026-10-20T08:02:00.000Z"),/Future synthetic recipient observation/);
});

test("bounce and complaint on different proposals remain sticky",()=>{
  const bounce=make(1,["reserved","provider_accepted","provider_bounced"]);
  const complaint=make(2,["reserved","provider_accepted","provider_delivered","provider_complained"]);
  const clean=make(3,["reserved","provider_accepted","provider_delivered"]);
  const result=scan([bounce,clean,complaint]);
  assert.equal(result.contact,"suppressed-in-fixtures");
  assert.deepEqual(result.suppression,["bounced","complained"]);
  assert.equal(result.examinedStreams,3);
  assert.deepEqual(result,scan([complaint,bounce,clean]));
});
test("empty or clean history never authorizes contacting",()=>{
  const empty=scan([]);
  const clean=scan([delivered()]);
  assert.equal(empty.contact,"no-suppression-seen-in-fixtures");
  assert.equal(empty.examinedStreams,0);
  assert.equal(empty.contactAuthorized,false);
  assert.equal(clean.contact,"no-suppression-seen-in-fixtures");
  assert.equal(clean.contactAuthorized,false);
});
test("cross-tenant and cross-recipient histories fail instead of being silently dropped",()=>{
  assert.throws(()=>scan([make(1,["reserved"],OTHER)]),/Cross-tenant or cross-recipient/);
  assert.throws(()=>scan([make(1,["reserved"],ORG,"other@fictional.example")]),/Cross-tenant or cross-recipient/);
  assert.throws(()=>scan([delivered()],"2026-10-22"),/Invalid synthetic recipient history/);
});
test("duplicate proposal keys, including target proposal, must not obscure suppression",()=>{
  const old=make(1,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  assert.throws(()=>scan([old,{...old}]),/Duplicate or current-proposal/);
  assert.throws(()=>scan([make(0,["reserved"],ORG,RECIPIENT,2)]),/Duplicate or current-proposal/);
  const previousRevision=make(0,["reserved","provider_accepted","provider_bounced"],ORG,RECIPIENT,1);
  assert.deepEqual(scan([previousRevision]).suppression,["bounced"]);
});
test("conflicting hashes cannot masquerade as different histories for one immutable revision",()=>{
  const original=make(1,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  const changedFields={...original.intent,contentSha256:"e".repeat(64)};
  const {idempotencyKey: _oldKey,...newIdentity}=changedFields;
  const changedIntent={...newIdentity,idempotencyKey:deliveryIdempotencyKey(newIdentity)};
  const changed={intent:changedIntent,events:original.events.map((event,index)=>({
    ...event,idempotencyKey:changedIntent.idempotencyKey,
    eventId:String(81+index).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }))};
  assert.notEqual(changedIntent.idempotencyKey,original.intent.idempotencyKey);
  assert.throws(()=>scan([original,changed]),/Duplicate or current-proposal/);
  assert.throws(()=>scan([changed,original]),/Duplicate or current-proposal/);
  const targetRevisionConflict=make(0,["reserved"],ORG,RECIPIENT,2);
  const alteredTarget={...targetRevisionConflict.intent,policySha256:"f".repeat(64)};
  const {idempotencyKey: _targetKey,...alteredTargetIdentity}=alteredTarget;
  const previousKey={...alteredTargetIdentity,
    idempotencyKey:deliveryIdempotencyKey(alteredTargetIdentity)};
  assert.throws(()=>scan([{intent:previousKey,events:[]}]),/Duplicate or current-proposal/);
  // A genuinely earlier numbered revision of the same proposal is valid history.
  assert.deepEqual(scan([make(0,["reserved","provider_accepted","provider_bounced"],ORG,RECIPIENT,1)]).suppression,["bounced"]);
});

test("later revisions of the target proposal cannot masquerade as earlier history",()=>{
  const future=make(0,["reserved","provider_accepted","provider_delivered","recipient_opted_out"],
    ORG,RECIPIENT,3);
  assert.throws(()=>scan([future]),/Duplicate or current-proposal/);
  // Revisions are proposal-scoped, not a tenant-wide counter.
  const otherProposal=make(1,[],ORG,RECIPIENT,9);
  assert.equal(scan([otherProposal]).examinedStreams,1);
  assert.equal(scan([otherProposal]).contactAuthorized,false);
});

test("event IDs reused across proposal streams fail, exact within-stream replay remains safe",()=>{
  const a=make(1,["reserved","provider_accepted"]);
  const b=make(2,["reserved","provider_accepted"]);
  b.events[0]={...b.events[0],eventId:a.events[0].eventId};
  assert.throws(()=>scan([a,b]),/Cross-proposal synthetic event ID collision/);
  const reply=make(1,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  reply.events.push({...reply.events[3]});
  assert.deepEqual(scan([reply]).suppression,["opted_out"]);
});
test("future observations and impossible or cross-scoped event streams fail",()=>{
  const future=make(1,["reserved","provider_accepted","provider_delivered","recipient_opted_out"]);
  assert.throws(()=>scan([future],"2026-10-20T08:02:00.000Z"),/Future synthetic recipient observation/);
  assert.throws(()=>scan([make(1,["provider_delivered"])]),/Unexpected provider delivery/);
  const altered=delivered();
  altered.events[1]={...altered.events[1],organizationId:OTHER};
  assert.throws(()=>scan([altered]),/cross-tenant delivery event/);
});
test("malformed, decorated, sparse and accessor-backed evidence fails closed",()=>{
  assert.throws(()=>scan(Array(31).fill(delivered())),/Invalid synthetic recipient history/);
  assert.throws(()=>scan(new Array(1)),/Invalid synthetic recipient history/);
  const entries=[delivered()];
  entries[Symbol("hidden")]="allow";
  assert.throws(()=>scan(entries),/Invalid synthetic recipient history/);
  assert.throws(()=>scan([{...delivered(),approved:true}]),/Invalid synthetic recipient history record/);
  let getterCalls=0;
  const accessor=delivered();
  Object.defineProperty(accessor,"intent",{enumerable:true,get(){getterCalls++;throw Error("Unsafe getter");}});
  assert.throws(()=>scan([accessor]),/Invalid synthetic recipient history record/);
  assert.equal(getterCalls,0);
  assert.throws(()=>scan([],"invalid"),/Invalid synthetic recipient history/);
});
