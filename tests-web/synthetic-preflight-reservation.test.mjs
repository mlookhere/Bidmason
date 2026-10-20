import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {SyntheticDispatchReservationLedger}
  from "../lib/synthetic-dispatch-reservation.ts";
import {rehearseSyntheticDeliveryReservation}
  from "../lib/synthetic-preflight-reservation.ts";

const BASE={organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:3,
  sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient:"buyer@example.test"};
const ACTORS=["cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];
const NOW="2026-10-22T10:00:00.000Z";
const make=(changes={})=>{
  const identity={...BASE,...changes};
  const {idempotencyKey:_ignored,...raw}=identity;
  const key=deliveryIdempotencyKey(raw);
  const {recipient,...revision}=raw;
  return {
    intent:{...raw,idempotencyKey:key},
    proposal:{...raw,reviewState:"reviewed"},
    receipts:["operator","contractor"].map((role,i)=>({
      ...revision,role,actorId:ACTORS[i],
    })),
    suppression:{organizationId:raw.organizationId,recipient,state:"clear",version:4},
    dispatch:{idempotencyKey:key,state:"absent"},
  };
};
const review=(ledger,evidence=make(),history=[],version=0,now=NOW)=>
  rehearseSyntheticDeliveryReservation(ledger,evidence,history,now,version);
function history(kind="recipient_opted_out"){
  const prior=make({revision:2});
  const kinds=["reserved","provider_accepted","provider_delivered",kind];
  return [{
    intent:prior.intent,
    events:kinds.map((k,i)=>({
      eventId:String(i+1).padStart(8,"0")+"-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId:prior.intent.organizationId,
      idempotencyKey:prior.intent.idempotencyKey,recipient:prior.intent.recipient,
      kind:k,observedAt:"2026-10-20T08:"+String(i).padStart(2,"0")+":00.000Z",
    })),
  }];
}

test("reviewed fictional exact revision can reserve only in simulation",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const r=review(ledger);
  assert.equal(r.state,"reserved-simulation-only");
  assert.equal(r.reason,"synthetic-cas-won-no-send");
  assert.equal(r.observedHistory,"caller-fixtures-only");
  assert.equal(r.contactAuthorized,false);
  assert.deepEqual(r.blockers,[]);
  assert.equal(r.reservationVersion,1);
  const json=JSON.stringify(r);
  for(const forbidden of ["buyer@example.test",BASE.organizationId,BASE.proposalId,
    "dryrun_","sendAllowed","authenticated","providerAuthenticated"])
    assert.equal(json.includes(forbidden),false);
});

test("stale proposal, altered QA hashes, and revoked signoffs never reserve",()=>{
  for(const change of [
    evidence=>{evidence.proposal.revision=4},
    evidence=>{evidence.proposal.qaSha256="e".repeat(64)},
    evidence=>{evidence.proposal.reviewState="revoked"},
    evidence=>{evidence.receipts[1].revision=4},
  ]){
    const ledger=new SyntheticDispatchReservationLedger();
    const evidence=make();
    change(evidence);
    const r=review(ledger,evidence);
    assert.equal(r.state,"blocked");
    assert.equal(r.reason,"preflight-blocked");
    assert.equal(ledger.snapshot(evidence.intent).version,0);
    assert.equal(r.contactAuthorized,false);
  }
});

test("different, missing or forged reviewer roles and actors block before CAS",()=>{
  for(const edit of [
    e=>{e.receipts[1].role="operator"},
    e=>{e.receipts[1].actorId=e.receipts[0].actorId},
    e=>{e.receipts[0].sourceSha256="f".repeat(64)},
    e=>{e.receipts=[]},
  ]){
    const e=make();edit(e);
    const ledger=new SyntheticDispatchReservationLedger();
    const fn=()=>review(ledger,e);
    if(e.receipts.length!==2)assert.throws(fn,/Invalid internal delivery preflight evidence/);
    else assert.equal(fn().reason,"preflight-blocked");
    assert.equal(ledger.snapshot(e.intent).version,0);
  }
});

test("unknown current consent, opt-out and already dispatched status prevent reservation",()=>{
  for(const state of ["opted_out","bounced","unknown"]){
    const e=make();e.suppression.state=state;
    const ledger=new SyntheticDispatchReservationLedger();
    assert.equal(review(ledger,e).reason,"preflight-blocked");
    assert.equal(ledger.snapshot(e.intent).version,0);
  }
  for(const state of ["reserved","sent","unknown"]){
    const e=make();e.dispatch.state=state;
    const ledger=new SyntheticDispatchReservationLedger();
    assert.equal(review(ledger,e).reason,"preflight-blocked");
    assert.equal(ledger.snapshot(e.intent).version,0);
  }
});

test("historical opt-out blocks an otherwise clean-looking preflight",()=>{
  for(const kind of ["recipient_opted_out","provider_complained"]){
    const ledger=new SyntheticDispatchReservationLedger();
    const r=review(ledger,make(),history(kind));
    assert.equal(r.state,"blocked");
    assert.equal(r.reason,"prior-recipient-suppressed");
    assert.equal(r.reservationVersion,0);
    assert.equal(ledger.snapshot(make().intent).reserved,false);
  }
  const past=make({revision:2});
  const bounced=[{intent:past.intent,events:history()[0].events.slice(0,2).concat({
    ...history()[0].events[2],kind:"provider_bounced",
  })}];
  assert.equal(review(new SyntheticDispatchReservationLedger(),make(),bounced).reason,
    "prior-recipient-suppressed");
});

test("invalid history still fails even when the proposal was already blocked",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const e=make();e.proposal.reviewState="revoked";
  const wrong=history();
  wrong[0].intent={...wrong[0].intent,organizationId:"ffffffff-ffff-4fff-8fff-ffffffffffff"};
  assert.throws(()=>review(ledger,e,wrong),/Invalid proposed delivery identity|Invalid simulated delivery identity/);
  assert.equal(ledger.snapshot(e.intent).version,0);
  assert.throws(()=>review(ledger,e,[],-1,"not-time"),/Invalid synthetic recipient history/);
});

test("same-version reviewers racing for one recipient get only one simulated winner",async()=>{
  const ledger=new SyntheticDispatchReservationLedger(), e=make();
  const results=await Promise.all(Array.from({length:48},()=>Promise.resolve().then(()=>
    review(ledger,e,[],0))));
  assert.equal(results.filter(x=>x.state==="reserved-simulation-only").length,1);
  assert.equal(results.filter(x=>x.state==="blocked").length,47);
  assert.equal(ledger.snapshot(e.intent).version,1);
  assert.ok(results.every(x=>x.contactAuthorized===false));
});

test("different proposal for same recipient cannot bypass existing simulated reservation",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  assert.equal(review(ledger).state,"reserved-simulation-only");
  const another=make({proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"});
  assert.equal(review(ledger,another,[],1).reason,"recipient-already-reserved");
  assert.equal(ledger.snapshot(another.intent).version,1);
});

test("simulated opt-out before reservation blocks; after reservation it invalidates lock",()=>{
  const before=new SyntheticDispatchReservationLedger(), e=make();
  before.compareAndSuppress(e.intent,0,"opted_out");
  assert.equal(review(before,e,[],1).reason,"recipient-suppressed");
  const after=new SyntheticDispatchReservationLedger();
  assert.equal(review(after,e).state,"reserved-simulation-only");
  after.compareAndSuppress(e.intent,1,"opted_out");
  assert.equal(after.snapshot(e.intent).reserved,false);
  assert.equal(review(after,e,[],2).reason,"recipient-suppressed");
});

test("version conflicts and replay after success remain blocked",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  assert.equal(review(ledger).state,"reserved-simulation-only");
  assert.equal(review(ledger,make(),[],0).reason,"stale-or-invalid-version");
  assert.equal(review(ledger,make(),[],1).reason,"recipient-already-reserved");
  assert.equal(review(ledger,make(),[],-1).reason,"stale-or-invalid-version");
});

test("malformed evidence containers and accessor-backed fields fail without mutation",()=>{
  const ledger=new SyntheticDispatchReservationLedger(), e=make();
  assert.throws(()=>review(ledger,{...e,authorized:true}),/Invalid synthetic reservation rehearsal evidence/);
  let getterCalls=0;
  const evil={...e};
  Object.defineProperty(evil,"intent",{enumerable:true,get(){getterCalls++;throw Error("accessor")}});
  assert.throws(()=>review(ledger,evil),/Invalid synthetic reservation rehearsal evidence/);
  assert.equal(getterCalls,0);
  assert.throws(()=>review({},e),/Invalid synthetic reservation rehearsal evidence/);
  assert.equal(ledger.snapshot(e.intent).version,0);
});
