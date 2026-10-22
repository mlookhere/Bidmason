import test from "node:test";
import assert from "node:assert/strict";
import {createHash, createHmac, randomBytes} from "node:crypto";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {verifySyntheticWebhookFixture} from "../lib/synthetic-webhook-verification.ts";

const revision = {organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",revision:3,
  sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),recipient:"buyer@example.test"};
const intent={...revision,idempotencyKey:deliveryIdempotencyKey(revision)};
const secret=randomBytes(32);
const instant=Math.floor(Date.parse("2026-10-20T08:00:00.000Z")/1000);
const event={eventId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind:"provider_delivered",observedAt:"2026-10-20T08:00:00.000Z"};
const body=e=>Buffer.from(JSON.stringify(e));
const signed=(bytes,t=instant,key=secret)=>"t="+t+",v1="+createHmac("sha256",key)
  .update("bidmason:synthetic-webhook:v1\n").update(String(t))
  .update("\n").update(bytes).digest("hex");
const verify=(bytes=body(event),header=signed(bytes),now=instant,
  context=intent,ledger=[],key=secret)=>
  verifySyntheticWebhookFixture(bytes,header,now,key,context,ledger);

test("correct raw-body fixture HMAC is only an internal signature assessment",()=>{
  const raw=body(event), result=verify(raw);
  assert.equal(result.state,"fixture-verified-only");
  assert.equal(result.eventId,event.eventId);
  assert.equal(result.kind,"provider_delivered");
  assert.equal(result.bodySha256,createHash("sha256").update(raw).digest("hex"));
  for(const field of ["authenticatedProvider","authorized","sent","persisted","recipientEmail"])
    assert.equal(Object.hasOwn(result,field),false);
});

test("identical event replays are recognized but conflict is blocked",()=>{
  const raw=body(event), first=verify(raw);
  assert.equal(verify(raw,signed(raw),instant,intent,[
    {eventId:event.eventId,bodySha256:first.bodySha256}]).state,"fixture-duplicate-only");
  assert.equal(verify(raw,signed(raw),instant,intent,[
    {eventId:event.eventId,bodySha256:"0".repeat(64)}]).state,"blocked");
});

test("processed fixture ledger cannot contain contradictory unrelated event IDs",()=>{
  const raw=body(event), first=verify(raw);
  const unrelated="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const recorded={eventId:unrelated,bodySha256:"a".repeat(64)};
  const conflicting={eventId:unrelated,bodySha256:"b".repeat(64)};
  for(const ledger of [[recorded,conflicting],[conflicting,recorded]]){
    // The incoming event ID is different; ignoring unrelated ledger corruption
    // would falsely report a coherent synthetic replay ledger.
    assert.throws(()=>verify(raw,signed(raw),instant,intent,ledger),
      /Invalid synthetic webhook verification context/);
  }
  assert.equal(verify(raw,signed(raw),instant,intent,[recorded,{...recorded}]).state,
    "fixture-verified-only");
  const present={eventId:event.eventId,bodySha256:first.bodySha256};
  assert.equal(verify(raw,signed(raw),instant,intent,[present,{...present}]).state,
    "fixture-duplicate-only");
  assert.throws(()=>verify(raw,signed(raw),instant,intent,[present,
    {...present,bodySha256:"0".repeat(64)}]),
    /Invalid synthetic webhook verification context/);
});

test("tampering, wrong keys and malformed signatures are rejected",()=>{
  const raw=body(event), head=signed(raw);
  assert.equal(verify(Buffer.concat([raw,Buffer.from(" ")]),head).state,"blocked");
  assert.equal(verify(raw,head,instant,intent,[],randomBytes(32)).state,"blocked");
  for(const variant of [head.replace("v1=","v2="),head+",v1="+"0".repeat(64),
    head.replace(",v1=",",v1=0"),head.toUpperCase(),"no-signature"])
    assert.equal(verify(raw,variant).state,"blocked");
});

test("timestamps expire in both directions and event observation must agree",()=>{
  const raw=body(event);
  assert.equal(verify(raw,signed(raw),instant+301).state,"blocked");
  assert.equal(verify(raw,signed(raw),instant-301).state,"blocked");
  assert.equal(verify(raw,signed(raw),instant+300).state,"fixture-verified-only");
  const altered=body({...event,observedAt:"2026-10-20T09:00:00.000Z"});
  assert.equal(verify(altered,signed(altered)).state,"blocked");
});

test("event observation freshness is bounded directly to receipt, not chained windows",()=>{
  // Previously both comparisons were within 300 seconds, but their
  // composition admitted an observation 600 seconds from receipt.
  for (const sign of [-1,1]) {
    const eventAt=instant+sign*600;
    const signedAt=instant+sign*300;
    const raw=body({...event,observedAt:new Date(eventAt*1000).toISOString()});
    assert.equal(verify(raw,signed(raw,signedAt),instant).state,"blocked");
  }
  for (const sign of [-1,1]) {
    const observedAt=instant+sign*300;
    const raw=body({...event,observedAt:new Date(observedAt*1000).toISOString()});
    assert.equal(verify(raw,signed(raw,instant),instant).state,"fixture-verified-only");
  }
  const tooOld=body({...event,
    observedAt:new Date((instant-301)*1000).toISOString()});
  assert.equal(verify(tooOld,signed(tooOld,instant),instant).state,"blocked");
  const tooNew=body({...event,
    observedAt:new Date((instant+301)*1000).toISOString()});
  assert.equal(verify(tooNew,signed(tooNew,instant),instant).state,"blocked");
});

test("subsecond timestamps cannot escape the exact five-minute freshness window",()=>{
  const baseMs=instant*1000;
  for (const direction of [-1,1]) {
    const onBoundary=body({...event,observedAt:
      new Date(baseMs+direction*300000).toISOString()});
    const beyondOneMillisecond=body({...event,observedAt:
      new Date(baseMs+direction*300001).toISOString()});
    const beyondNearlyOneSecond=body({...event,observedAt:
      new Date(baseMs+direction*300999).toISOString()});
    assert.equal(verify(onBoundary,signed(onBoundary,instant),instant).state,
      "fixture-verified-only");
    for (const raw of [beyondOneMillisecond,beyondNearlyOneSecond]) {
      assert.equal(verify(raw,signed(raw,instant),instant).state,"blocked");
    }
  }
  // The event-header check must also use milliseconds when the signed
  // header sits at the extreme edge of the independent receive allowance.
  const futureHeader=instant+300;
  const eventAfterHeader=body({...event,observedAt:
    new Date((futureHeader+300)*1000+1).toISOString()});
  assert.equal(verify(eventAfterHeader,signed(eventAfterHeader,futureHeader),instant)
    .state,"blocked");
});

test("changed tenant, recipient, revision key and unsupported reserved events are blocked",()=>{
  for(const change of [{organizationId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
    {recipient:"someone-else@example.test"},
    {idempotencyKey:"dryrun_"+"0".repeat(64)}, {kind:"reserved"},
    {approved:true}]){
    const raw=body({...event,...change});
    assert.equal(verify(raw,signed(raw)).state,"blocked");
  }
  const updated={...revision,revision:4};
  assert.throws(()=>verify(body(event),signed(body(event)),instant,
    {...updated,idempotencyKey:intent.idempotencyKey}),/Invalid synthetic webhook verification context/);
});

test("duplicate JSON keys, noncanonical bytes and bad UTF-8 are refused even when signed",()=>{
  const original=body(event).toString("utf8");
  const duplicate=Buffer.from(original.replace('"eventId":',
    '"eventId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","eventId":'));
  for(const raw of [duplicate,Buffer.from(" "+original),Buffer.from(original+"\n"),
    Buffer.concat([Buffer.from(original),Buffer.from([255])])]){
    assert.equal(verify(raw,signed(raw)).state,"blocked");
  }
});

test("malformed receipt histories and getter-based evidence fail before side effects",()=>{
  const raw=body(event);
  for(const ledger of [[{eventId:"bad",bodySha256:"0".repeat(64)}],
    [{eventId:event.eventId,bodySha256:"0".repeat(64),approve:true}],new Array(1)])
    assert.throws(()=>verify(raw,signed(raw),instant,intent,ledger),/Invalid synthetic webhook verification context/);
  const poisoned={...intent}; let calls=0;
  Object.defineProperty(poisoned,"recipient",{enumerable:true,get(){calls++;throw Error("getter");}});
  assert.throws(()=>verify(raw,signed(raw),instant,poisoned),/Invalid synthetic webhook verification context/);
  assert.equal(calls,0);
});

test("weak keys, large bodies, bad time inputs and fake headers fail closed",()=>{
  const raw=body(event), head=signed(raw);
  assert.throws(()=>verify(raw,head,instant,intent,[],randomBytes(16)),/Invalid synthetic webhook verification context/);
  assert.throws(()=>verify(Buffer.alloc(4097),head),/Invalid synthetic webhook verification context/);
  assert.throws(()=>verify(raw,head,NaN),/Invalid synthetic webhook verification context/);
  assert.equal(verify(raw,"t=00001,v1="+"0".repeat(64)).state,"blocked");
});
