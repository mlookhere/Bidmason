import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {SyntheticDispatchReservationLedger}
  from "../lib/synthetic-dispatch-reservation.ts";

const base={organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:1,
  sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),
  recipient:"buyer@fictional.example"};
const make=(overrides={})=>{
  const fields={...base,...overrides};
  return {...fields,idempotencyKey:deliveryIdempotencyKey(fields)};
};
const intent=make();

test("first simulated CAS wins but never authorizes customer communication",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const before=ledger.snapshot(intent);
  assert.deepEqual(before,{state:"simulation-only",version:0,reserved:false,
    suppression:[],contactAuthorized:false});
  const first=ledger.compareAndReserve(intent,before.version);
  assert.equal(first.state,"reserved-simulation-only");
  assert.equal(first.snapshot.version,1);
  assert.equal(first.snapshot.reserved,true);
  assert.equal(first.snapshot.contactAuthorized,false);
  for(const x of ["send","provider","email","dispatchKey","recipient","organizationId","idempotencyKey"])
    assert.equal(Object.hasOwn(first,x),false);
});

test("many competing asynchronous callers using the same snapshot admit exactly one winner",async()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const initial=ledger.snapshot(intent);
  const results=await Promise.all(Array.from({length:64},()=>Promise.resolve().then(()=>
    ledger.compareAndReserve(intent,initial.version))));
  assert.equal(results.filter(x=>x.state==="reserved-simulation-only").length,1);
  assert.equal(results.filter(x=>x.state==="blocked").length,63);
  assert.equal(ledger.snapshot(intent).version,1);
});

test("same-key replay and other proposal for same recipient both block",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  assert.equal(ledger.compareAndReserve(intent,0).state,"reserved-simulation-only");
  assert.equal(ledger.compareAndReserve(intent,0).reason,"stale-or-invalid-version");
  assert.equal(ledger.compareAndReserve(intent,1).reason,"recipient-already-reserved");
  const other=make({proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",revision:2});
  assert.equal(ledger.compareAndReserve(other,1).reason,"recipient-already-reserved");
});

test("historical fictional opt-out wins before any reservation",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const first=ledger.compareAndSuppress(intent,0,"opted_out");
  assert.equal(first.state,"suppressed-simulation-only");
  assert.deepEqual(first.snapshot.suppression,["opted_out"]);
  assert.equal(ledger.compareAndReserve(intent,1).reason,"recipient-suppressed");
  assert.equal(ledger.snapshot(intent).contactAuthorized,false);
});

test("later opt-out invalidates an already simulated reserved proposal",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  assert.equal(ledger.compareAndReserve(intent,0).state,"reserved-simulation-only");
  const suppressed=ledger.compareAndSuppress(intent,1,"opted_out");
  assert.equal(suppressed.snapshot.reserved,false);
  assert.deepEqual(suppressed.snapshot.suppression,["opted_out"]);
  const next=make({proposalId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"});
  assert.equal(ledger.compareAndReserve(next,2).reason,"recipient-suppressed");
  assert.equal(ledger.compareAndReserve(intent,1).reason,"stale-or-invalid-version");
});

test("reservation and opt-out racing at same version never both succeed",async()=>{
  for(let i=0;i<24;i++){
    const ledger=new SyntheticDispatchReservationLedger();
    const operations=i%2===0?["reserve","suppress"]:["suppress","reserve"];
    const results=await Promise.all(operations.map(op=>Promise.resolve().then(()=>
      op==="reserve"?ledger.compareAndReserve(intent,0):
      ledger.compareAndSuppress(intent,0,"opted_out"))));
    assert.equal(results.filter(x=>x.state!=="blocked").length,1);
    const winner=results.find(x=>x.state!=="blocked");
    const snapshot=ledger.snapshot(intent);
    assert.equal(snapshot.version,1);
    assert.equal(snapshot.contactAuthorized,false);
    assert.equal(winner.state,operations[0]==="reserve"
      ?"reserved-simulation-only":"suppressed-simulation-only");
  }
});

test("suppression is sticky, reason-union is stable, and no lifting operation exists",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  assert.equal(ledger.compareAndSuppress(intent,0,"bounced").state,"suppressed-simulation-only");
  assert.equal(ledger.compareAndSuppress(intent,1,"bounced").reason,"duplicate-suppression");
  const last=ledger.compareAndSuppress(intent,1,"complained");
  assert.deepEqual(last.snapshot.suppression,["bounced","complained"]);
  assert.equal(ledger.compareAndReserve(intent,2).reason,"recipient-suppressed");
  assert.equal(typeof ledger.unsuppress,"undefined");
});

test("tenant and recipient scoped locks do not leak between unrelated fictional identities",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  ledger.compareAndSuppress(intent,0,"opted_out");
  const differentTenant=make({organizationId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd"});
  const differentRecipient=make({recipient:"second@fictional.example"});
  for(const safe of [differentTenant,differentRecipient]){
    assert.equal(ledger.snapshot(safe).version,0);
    assert.equal(ledger.compareAndReserve(safe,0).state,"reserved-simulation-only");
  }
  assert.deepEqual(ledger.snapshot(intent).suppression,["opted_out"]);
});

test("forged keys, hidden fields, accessors and invalid versions fail closed",()=>{
  const ledger=new SyntheticDispatchReservationLedger();
  const extra={...intent,approved:true};
  assert.throws(()=>ledger.snapshot(extra),/Invalid synthetic reservation identity/);
  const badKey={...intent,idempotencyKey:"dryrun_"+"0".repeat(64)};
  assert.throws(()=>ledger.compareAndReserve(badKey,0),/Invalid synthetic reservation identity/);
  let calls=0;
  const getter={...intent};
  Object.defineProperty(getter,"recipient",{enumerable:true,get(){calls++;throw Error("unexpected")}});
  assert.throws(()=>ledger.snapshot(getter),/Invalid synthetic reservation identity/);
  assert.equal(calls,0);
  for(const invalid of [NaN,-1,0.5,Infinity,"0"]){
    assert.equal(ledger.compareAndReserve(intent,invalid).reason,"stale-or-invalid-version");
  }
  assert.throws(()=>ledger.compareAndSuppress(intent,0,"clear"),/Invalid synthetic suppression reason/);
  assert.deepEqual(ledger.snapshot(intent).suppression,[]);
});
