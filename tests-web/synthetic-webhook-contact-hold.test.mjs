import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,randomBytes} from "node:crypto";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {SyntheticDispatchReservationLedger}
  from "../lib/synthetic-dispatch-reservation.ts";
import {reconcileSyntheticWebhookContactHold,
  reconcileSyntheticWebhookContactHoldWithRetry}
  from "../lib/synthetic-webhook-contact-hold.ts";

const BASE={
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:3,
  sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),
  recipient:"buyer@example.test",
};
const intent={...BASE,idempotencyKey:deliveryIdempotencyKey(BASE)};
const secret=randomBytes(32);
const reservation={
  eventId:"00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind:"reserved",
  observedAt:"2026-10-20T08:00:00.000Z",
};
const event=(kind,minute,id=minute)=>({
  eventId:String(id).padStart(8,"0")+"-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind,
  observedAt:"2026-10-20T08:"+String(minute).padStart(2,"0")+":00.000Z",
});
function signed(item,key=secret){
  const rawBody=Buffer.from(JSON.stringify(item));
  const seconds=Date.parse(item.observedAt)/1000;
  const signatureHeader="t="+seconds+",v1="+createHmac("sha256",key)
    .update("bidmason:synthetic-webhook:v1\n").update(String(seconds))
    .update("\n").update(rawBody).digest("hex");
  return {rawBody,signatureHeader,receivedAtSeconds:seconds};
}
function reserve(ledger=new SyntheticDispatchReservationLedger()){
  assert.equal(ledger.compareAndReserve(intent,0).state,"reserved-simulation-only");
  return ledger;
}
const accepted=signed(event("provider_accepted",1));
const delivered=signed(event("provider_delivered",2));
const replied=signed(event("recipient_replied",3));
const apply=(ledger,items,version=1,identity=intent,res=reservation,key=secret)=>
  reconcileSyntheticWebhookContactHold(ledger,identity,res,items,key,version);

test("validated fictional reply after reservation creates hold and redacted result",()=>{
  const ledger=reserve();
  const result=apply(ledger,[accepted,delivered,replied]);
  assert.deepEqual(result,{
    state:"simulation-only",decision:"fictional-contact-hold-applied",
    reason:"synthetic-contact-signals-recorded",contactHold:"reply-review",
    reservationVersion:2,contactAuthorized:false,
  });
  assert.equal(ledger.snapshot(intent).reserved,false);
  assert.equal(ledger.snapshot(intent).replyReviewRequired,true);
  assert.equal(ledger.compareAndReserve(intent,2).reason,"recipient-reply-review-required");
  const serialized=JSON.stringify(result);
  for(const token of [BASE.recipient,BASE.organizationId,BASE.proposalId,"dryrun_"])
    assert.equal(serialized.includes(token),false);
});

test("out-of-order signed callbacks reconcile before applying the reply hold",()=>{
  const ledger=reserve();
  const result=apply(ledger,[replied,delivered,accepted]);
  assert.equal(result.contactHold,"reply-review");
  assert.equal(result.reservationVersion,2);
  assert.equal(ledger.snapshot(intent).reserved,false);
});

test("signed fictional bounce and reply apply atomically as stop contact",()=>{
  const ledger=reserve();
  const complaint=signed(event("provider_complained",4));
  const result=apply(ledger,[complaint,replied,accepted,delivered]);
  assert.equal(result.contactHold,"stop-contact");
  assert.equal(result.reservationVersion,2);
  assert.deepEqual(ledger.snapshot(intent).suppression,["complained"]);
  assert.equal(ledger.snapshot(intent).replyReviewRequired,true);
  assert.equal(ledger.compareAndReserve(intent,2).reason,"recipient-suppressed");
});

test("empty/duplicate signed contact signals never bump version on replay",()=>{
  const ledger=reserve();
  const clean=apply(ledger,[accepted,delivered]);
  assert.equal(clean.decision,"blocked");
  assert.equal(clean.reason,"duplicate-or-empty-contact-signals");
  assert.equal(ledger.snapshot(intent).version,1);
  apply(ledger,[accepted,delivered,replied]);
  const duplicate=apply(ledger,[accepted,delivered,replied,replied],2);
  assert.equal(duplicate.decision,"blocked");
  assert.equal(duplicate.reason,"duplicate-or-empty-contact-signals");
  assert.equal(ledger.snapshot(intent).version,2);
});

test("invalid HMAC, forged tenant and chronology fail before any CAS state change",()=>{
  for(const bad of [
    [signed(event("recipient_replied",3),randomBytes(32))],
    [signed({...event("provider_accepted",1),
      organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"})],
    [delivered,replied],
    [{...replied,rawBody:Buffer.from(JSON.stringify(event("provider_bounced",3)))}],
  ]){
    const ledger=reserve();
    assert.throws(()=>apply(ledger,bad));
    assert.equal(ledger.snapshot(intent).version,1);
    assert.equal(ledger.snapshot(intent).reserved,true);
  }
});

test("stale versions and competing reconciliations admit only one change",async()=>{
  const ledger=reserve();
  const results=await Promise.all(Array.from({length:32},()=>
    Promise.resolve().then(()=>apply(ledger,[accepted,delivered,replied],1))));
  assert.equal(results.filter(x=>x.decision==="fictional-contact-hold-applied").length,1);
  assert.equal(results.filter(x=>x.reason==="stale-or-invalid-version").length,31);
  assert.equal(ledger.snapshot(intent).version,2);
  assert.equal(ledger.snapshot(intent).reserved,false);
});

test("injected malformed direct contact signals are rejected before ledger mutation",()=>{
  const ledger=reserve();
  for(const signals of [
    {replied:true,suppression:["complained"],sendAllowed:true},
    {replied:"yes",suppression:[]},
    {replied:false,suppression:["clear"]},
    {replied:true,suppression:["opted_out","opted_out"]},
    {replied:true,suppression:["opted_out","bounced"]},
    {replied:false,suppression:[,"opted_out"]},
  ]){
    assert.throws(()=>ledger.compareAndApplyContactSignals(intent,1,signals),
      /Invalid synthetic contact signals/);
    assert.equal(ledger.snapshot(intent).version,1);
  }
  let reads=0;
  const accessor={suppression:[],replied:true};
  Object.defineProperty(accessor,"replied",{enumerable:true,get(){reads++;return true}});
  assert.throws(()=>ledger.compareAndApplyContactSignals(intent,1,accessor),
    /Invalid synthetic contact signals/);
  assert.equal(reads,0);
  assert.equal(ledger.snapshot(intent).version,1);
});

test("unrelated tenant remains isolated and permanent suppression cannot lift",()=>{
  const ledger=reserve();
  apply(ledger,[accepted,delivered,replied]);
  const second={...BASE,organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"};
  const outside={...second,idempotencyKey:deliveryIdempotencyKey(second)};
  assert.equal(ledger.snapshot(outside).version,0);
  const direct=ledger.compareAndApplyContactSignals(intent,2,{
    replied:false,suppression:["opted_out"],
  });
  assert.equal(direct.state,"suppressed-simulation-only");
  assert.equal(ledger.snapshot(intent).replyReviewRequired,true);
  assert.equal(ledger.compareAndReserve(intent,3).reason,"recipient-suppressed");
  assert.equal(ledger.snapshot(outside).version,0);
});

test("bounded stale recheck closes a fictional reserved-vs-reply version race",()=>{
  const ledger=reserve();
  const r=reconcileSyntheticWebhookContactHoldWithRetry(
    ledger,intent,reservation,[accepted,delivered,replied],secret,0,1);
  assert.deepEqual(r,{
    state:"simulation-only",decision:"fictional-contact-hold-applied",
    reason:"synthetic-contact-signals-recorded",contactHold:"reply-review",
    reservationVersion:2,contactAuthorized:false,staleRechecks:1,
    unresolvedStaleVersion:false,
  });
  assert.equal(ledger.snapshot(intent).reserved,false);
  assert.equal(ledger.compareAndReserve(intent,2).reason,"recipient-reply-review-required");
});

test("zero-retry stale result is visibly unresolved and does not alter reservation",()=>{
  const ledger=reserve();
  const r=reconcileSyntheticWebhookContactHoldWithRetry(
    ledger,intent,reservation,[accepted,delivered,replied],secret,0,0);
  assert.equal(r.decision,"blocked");
  assert.equal(r.reason,"stale-or-invalid-version");
  assert.equal(r.contactHold,"none");
  assert.equal(r.unresolvedStaleVersion,true);
  assert.equal(r.staleRechecks,0);
  assert.equal(ledger.snapshot(intent).version,1);
  assert.equal(ledger.snapshot(intent).reserved,true);
});

test("replayed signed reply after refreshed-version retry remains no-op",()=>{
  const ledger=reserve();
  apply(ledger,[accepted,delivered,replied]);
  const r=reconcileSyntheticWebhookContactHoldWithRetry(
    ledger,intent,reservation,[accepted,delivered,replied,{...replied}],secret,1,2);
  assert.equal(r.decision,"blocked");
  assert.equal(r.reason,"duplicate-or-empty-contact-signals");
  assert.equal(r.staleRechecks,1);
  assert.equal(r.unresolvedStaleVersion,false);
  assert.equal(r.contactHold,"reply-review");
  assert.equal(ledger.snapshot(intent).version,2);
});

test("stale combined reply plus opt-out is applied in one refreshed CAS",()=>{
  const ledger=reserve();
  const optOut=signed(event("recipient_opted_out",4));
  const r=reconcileSyntheticWebhookContactHoldWithRetry(
    ledger,intent,reservation,[optOut,replied,delivered,accepted],secret,0,1);
  assert.equal(r.decision,"fictional-contact-hold-applied");
  assert.equal(r.contactHold,"stop-contact");
  assert.equal(r.staleRechecks,1);
  assert.equal(r.reservationVersion,2);
  assert.deepEqual(ledger.snapshot(intent).suppression,["opted_out"]);
  assert.equal(ledger.snapshot(intent).replyReviewRequired,true);
  assert.equal(ledger.compareAndReserve(intent,2).reason,"recipient-suppressed");
});

test("many concurrent synthetic stale retries cannot duplicate holds or version bumps",async()=>{
  const ledger=reserve();
  const results=await Promise.all(Array.from({length:36},()=>Promise.resolve().then(()=>
    reconcileSyntheticWebhookContactHoldWithRetry(
      ledger,intent,reservation,[accepted,delivered,replied],secret,0,2))));
  assert.equal(results.filter(x=>x.decision==="fictional-contact-hold-applied").length,1);
  assert.equal(results.filter(x=>x.reason==="duplicate-or-empty-contact-signals").length,35);
  assert.ok(results.every(x=>x.staleRechecks===1&&x.unresolvedStaleVersion===false));
  assert.ok(results.every(x=>x.contactAuthorized===false));
  assert.equal(ledger.snapshot(intent).version,2);
  assert.equal(ledger.snapshot(intent).reserved,false);
});

test("bad signatures and tenant evidence fail before any retry or ledger mutation",()=>{
  for(const envelopes of [
    [signed(event("recipient_replied",3),randomBytes(32))],
    [signed({...event("provider_accepted",1),
      recipient:"different@example.test"}),delivered,replied],
    [delivered,replied],
  ]){
    const ledger=reserve();
    assert.throws(()=>reconcileSyntheticWebhookContactHoldWithRetry(
      ledger,intent,reservation,envelopes,secret,0,3));
    assert.equal(ledger.snapshot(intent).version,1);
    assert.equal(ledger.snapshot(intent).reserved,true);
  }
});

test("retry budget and invalid input cannot bypass the strict single-attempt contract",()=>{
  for(const invalid of [-1,4,Infinity,NaN,0.5,"1",null]){
    const ledger=reserve();
    assert.throws(()=>reconcileSyntheticWebhookContactHoldWithRetry(
      ledger,intent,reservation,[accepted,delivered,replied],secret,0,invalid),
      /Invalid synthetic webhook contact-hold retry context/);
    assert.equal(ledger.snapshot(intent).version,1);
  }
  const ledger=reserve();
  const r=reconcileSyntheticWebhookContactHoldWithRetry(
    ledger,intent,reservation,[accepted,delivered,replied],secret,-1,3);
  assert.equal(r.reason,"stale-or-invalid-version");
  assert.equal(r.unresolvedStaleVersion,true);
  assert.equal(r.staleRechecks,0);
  assert.equal(ledger.snapshot(intent).version,1);
});
