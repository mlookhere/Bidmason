import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {SyntheticDispatchReservationLedger}
  from "../lib/synthetic-dispatch-reservation.ts";
import {rehearseSyntheticDeliveryReservation}
  from "../lib/synthetic-preflight-reservation.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposal="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const at="2026-10-22T10:00:00.000Z";
const make=(changes={})=>{
  const identity={organizationId:org,proposalId:proposal,revision:3,
    sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
    contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),
    recipient:"buyer@fictional.example",...changes};
  return {...identity,idempotencyKey:deliveryIdempotencyKey(identity)};
};
const close=(intent,changes={})=>({
  eventId:"77777777-7777-4777-8777-777777777777",
  organizationId:intent.organizationId,proposalId:intent.proposalId,
  revision:2,kind:"won",observedAt:"2026-10-21T10:00:00.000Z",...changes,
});

const asPreflight=intent=>{
  const {idempotencyKey,...original}=intent;
  const {recipient,...revision}=original;
  return {intent,proposal:{...original,reviewState:"reviewed"},
    receipts:[
      {...revision,role:"operator",actorId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
      {...revision,role:"contractor",actorId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
    ],suppression:{organizationId:intent.organizationId,
      recipient:intent.recipient,state:"clear",version:4},
    dispatch:{idempotencyKey,state:"absent"}};
};

test("terminal won/lost event invalidates every same-proposal recipient and revision",()=>{
  for(const kind of ["won","lost"]){
    const ledger=new SyntheticDispatchReservationLedger();
    const first=make(),second=make({revision:4,recipient:"second@fictional.example"});
    const other=make({proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      recipient:"third@fictional.example"});
    for(const intent of [first,second,other])
      assert.equal(ledger.compareAndReserve(intent,0).state,"reserved-simulation-only");
    assert.deepEqual(ledger.compareAndRecordDealClosure(second,[close(second,{kind})],at),{
      state:"closed-simulation-only",reason:"fictional-deal-closure-recorded",
      invalidatedReservations:2,contactAuthorized:false});
    for(const intent of [first,second]){
      assert.deepEqual([ledger.snapshot(intent).reserved,ledger.snapshot(intent).version],
        [false,2]);
      assert.equal(ledger.compareAndReserve(intent,2).reason,"proposal-closed");
    }
    assert.equal(ledger.snapshot(other).reserved,true);
    assert.equal(ledger.snapshot(other).version,1);
    const newRecipient=make({recipient:"new@fictional.example",revision:5});
    assert.equal(ledger.compareAndReserve(newRecipient,0).reason,"proposal-closed");
    const differentTenant=make({organizationId:"99999999-9999-4999-8999-999999999999"});
    assert.equal(ledger.compareAndReserve(differentTenant,0).state,"reserved-simulation-only");
  }
});

test("duplicate closure is idempotent; different terminal claim fails closed",()=>{
  const ledger=new SyntheticDispatchReservationLedger(),intent=make();
  const event=close(intent),other={...event,
    eventId:"88888888-8888-4888-8888-888888888888",kind:"lost"};
  assert.equal(ledger.compareAndRecordDealClosure(intent,[event,{...event}],at).state,
    "closed-simulation-only");
  assert.deepEqual(ledger.compareAndRecordDealClosure(intent,[{...event}],at),{
    state:"blocked",reason:"duplicate-deal-closure",
    invalidatedReservations:0,contactAuthorized:false});
  assert.throws(()=>ledger.compareAndRecordDealClosure(intent,[other],at),
    /Conflicting fictional terminal/);
  assert.throws(()=>ledger.compareAndRecordDealClosure(intent,[event,other],at),
    /Conflicting synthetic terminal/);
  assert.equal(ledger.compareAndReserve(intent,0).reason,"proposal-closed");
});

test("one terminal event ID cannot close another proposal in the same tenant",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const first=make();
  const second=make({proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    recipient:"other@fictional.example"});
  assert.equal(ledger.compareAndReserve(first,0).state,"reserved-simulation-only");
  assert.equal(ledger.compareAndReserve(second,0).state,"reserved-simulation-only");
  const event=close(first);
  assert.equal(ledger.compareAndRecordDealClosure(first,[event],at).invalidatedReservations,1);
  const before=ledger.snapshot(second);
  assert.throws(()=>ledger.compareAndRecordDealClosure(second,[close(second)],at),
    /Conflicting fictional terminal event identity across proposals/);
  assert.deepEqual(ledger.snapshot(second),before);
  assert.equal(before.reserved,true);
  // Collision neither creates a second terminal outcome nor unlocks delivery.
  assert.equal(ledger.compareAndReserve(second,1).reason,"recipient-already-reserved");
  const fresh=close(second,{eventId:"88888888-8888-4888-8888-888888888888"});
  assert.equal(ledger.compareAndRecordDealClosure(second,[fresh],at).invalidatedReservations,1);
  assert.equal(ledger.snapshot(second).reserved,false);
  assert.equal(ledger.compareAndRecordDealClosure(first,[event],at).reason,
    "duplicate-deal-closure");
});

test("terminal event identity is scoped to tenant, not a global ID",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const first=make();
  const other=make({organizationId:"99999999-9999-4999-8999-999999999999",
    proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"});
  assert.equal(ledger.compareAndReserve(first,0).state,"reserved-simulation-only");
  assert.equal(ledger.compareAndReserve(other,0).state,"reserved-simulation-only");
  assert.equal(ledger.compareAndRecordDealClosure(first,[close(first)],at).invalidatedReservations,1);
  assert.equal(ledger.compareAndRecordDealClosure(other,[close(other)],at).invalidatedReservations,1);
  assert.equal(ledger.snapshot(first).reserved,false);
  assert.equal(ledger.snapshot(other).reserved,false);
  assert.equal(ledger.compareAndReserve(other,2).reason,"proposal-closed");
});

test("competing cross-proposal closure replays admit only one fictional winner",async()=>{
  for(let i=0;i<32;i++){
    const ledger=new SyntheticDispatchReservationLedger();
    const first=make();
    const other=make({proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      recipient:"other@fictional.example"});
    ledger.compareAndReserve(first,0);
    ledger.compareAndReserve(other,0);
    const ordered=i%2?[first,other]:[other,first];
    const settled=await Promise.allSettled(ordered.map(item=>
      Promise.resolve().then(()=>ledger.compareAndRecordDealClosure(item,[close(item)],at))));
    assert.equal(settled.filter(x=>x.status==="fulfilled").length,1);
    const rejected=settled.filter(x=>x.status==="rejected");
    assert.equal(rejected.length,1);
    assert.match(rejected[0].reason.message,/Conflicting fictional terminal event identity/);
    assert.equal(ledger.snapshot(ordered[0]).reserved,false);
    assert.equal(ledger.snapshot(ordered[1]).reserved,true);
    assert.equal(ledger.snapshot(ordered[1]).version,1);
    const unique=close(ordered[1],{eventId:"88888888-8888-4888-8888-888888888888"});
    assert.equal(ledger.compareAndRecordDealClosure(ordered[1],[unique],at).state,
      "closed-simulation-only");
    assert.equal(ledger.snapshot(ordered[1]).reserved,false);
  }
});

test("invalid, unverified, cross-tenant and getter-backed closure never changes reservation",()=>{
  const ledger=new SyntheticDispatchReservationLedger(),intent=make();
  ledger.compareAndReserve(intent,0);
  for(const records of [[],new Array(1),
    [close(intent,{organizationId:"ffffffff-ffff-4fff-8fff-ffffffffffff"})],
    [close(intent,{proposalId:"ffffffff-ffff-4fff-8fff-ffffffffffff"})],
    [close(intent,{revision:4})],
    [close(intent,{observedAt:"2026-10-24T10:00:00.000Z"})],
    [close(intent,{approved:true})]]){
    assert.throws(()=>ledger.compareAndRecordDealClosure(intent,records,at),
      /Invalid|required|cross-tenant/);
    assert.equal(ledger.snapshot(intent).reserved,true);
    assert.equal(ledger.snapshot(intent).version,1);
  }
  let reads=0;
  const accessor=[close(intent)];
  Object.defineProperty(accessor,"0",{enumerable:true,get(){reads++;throw Error("unsafe")}});
  assert.throws(()=>ledger.compareAndRecordDealClosure(intent,accessor,at),/Invalid synthetic deal/);
  assert.equal(reads,0);
  assert.equal(ledger.snapshot(intent).version,1);
});

test("closure racing simulated reservation always leaves no same-proposal work reserved",async()=>{
  for(let i=0;i<36;i++){
    const ledger=new SyntheticDispatchReservationLedger(),intent=make();
    const actions=i%2?["reserve","close"]:["close","reserve"];
    const results=await Promise.all(actions.map(action=>Promise.resolve().then(()=>
      action==="close"?ledger.compareAndRecordDealClosure(intent,[close(intent)],at)
        :ledger.compareAndReserve(intent,0))));
    assert.ok(results.some(x=>x.state==="closed-simulation-only"));
    assert.equal(ledger.snapshot(intent).reserved,false);
    assert.equal(ledger.compareAndReserve(intent,ledger.snapshot(intent).version).reason,
      "proposal-closed");
  }
});

test("closed deal does not opt-out an unrelated proposal; permanent suppression still wins",()=>{
  const ledger=new SyntheticDispatchReservationLedger(),intent=make();
  ledger.compareAndReserve(intent,0);
  assert.equal(ledger.compareAndRecordDealClosure(intent,[close(intent)],at).invalidatedReservations,1);
  assert.deepEqual(ledger.snapshot(intent).suppression,[]);
  const another=make({proposalId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"});
  assert.equal(ledger.compareAndReserve(another,2).state,"reserved-simulation-only");
  assert.equal(ledger.compareAndSuppress(another,3,"opted_out").state,
    "suppressed-simulation-only");
  assert.equal(ledger.compareAndReserve(another,4).reason,"recipient-suppressed");
  assert.equal(ledger.compareAndReserve(intent,4).reason,"recipient-suppressed");
});

test("integrated preflight cannot re-reserve after previously recorded closure, even if omitted",()=>{
  const ledger=new SyntheticDispatchReservationLedger(),intent=make();
  const evidence=asPreflight(intent);
  assert.equal(rehearseSyntheticDeliveryReservation(ledger,evidence,[],at,0).state,
    "reserved-simulation-only");
  assert.equal(ledger.compareAndRecordDealClosure(intent,[close(intent)],at).invalidatedReservations,1);
  const revised=make({revision:4,recipient:"new@fictional.example"});
  const result=rehearseSyntheticDeliveryReservation(ledger,asPreflight(revised),[],at,0,[]);
  assert.equal(result.state,"blocked");
  assert.equal(result.reason,"proposal-closed");
  assert.equal(result.contactAuthorized,false);
  assert.equal(ledger.snapshot(revised).reserved,false);
  for(const text of [org,proposal,intent.recipient,"dryrun_"])
    assert.equal(JSON.stringify(result).includes(text),false);
});
