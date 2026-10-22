import test from "node:test";
import assert from "node:assert/strict";
import {createHmac, randomBytes} from "node:crypto";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {projectSignedSyntheticWebhookBatch, reconcileSignedSyntheticWebhookBatch}
  from "../lib/synthetic-webhook-batch.ts";

const base = {
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision: 3, sourceSha256: "a".repeat(64), policySha256: "b".repeat(64),
  contentSha256: "c".repeat(64), qaSha256: "d".repeat(64),
  recipient: "buyer@example.test",
};
const intent = {...base, idempotencyKey: deliveryIdempotencyKey(base)};
const secret = randomBytes(32);
const epoch = Date.parse("2026-10-20T08:00:00.000Z")/1000;
const reservation = {
  eventId: "00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: intent.organizationId, idempotencyKey: intent.idempotencyKey,
  recipient: intent.recipient, kind: "reserved",
  observedAt: "2026-10-20T08:00:00.000Z",
};
const event = (kind, minute, eventId=minute) => ({
  eventId: String(eventId).padStart(8,"0")+"-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organizationId: intent.organizationId, idempotencyKey: intent.idempotencyKey,
  recipient: intent.recipient, kind,
  observedAt: "2026-10-20T08:"+String(minute).padStart(2,"0")+":00.000Z",
});
const signed = (item,minute=Number(item.observedAt.slice(14,16)),key=secret) => {
  const rawBody=Buffer.from(JSON.stringify(item));
  const sent=epoch+minute*60;
  const signatureHeader="t="+sent+",v1="+createHmac("sha256",key)
    .update("bidmason:synthetic-webhook:v1\n").update(String(sent))
    .update("\n").update(rawBody).digest("hex");
  return {rawBody,signatureHeader,receivedAtSeconds:sent};
};
const project=(events,local=reservation,context=intent,key=secret) =>
  projectSignedSyntheticWebhookBatch(context,local,events,key);

test("real fixture bytes pass HMAC and become simulation-only CRM timeline",()=>{
  const items=[
    signed(event("provider_accepted",1)),
    signed(event("provider_delivered",2)),
    signed(event("recipient_replied",3)),
  ];
  const original=items.map(e=>Buffer.from(e.rawBody));
  const result=project(items);
  assert.equal(result.state,"simulation-only");
  assert.equal(result.projection.state,"simulation-only");
  assert.equal(result.projection.delivery,"reported_delivered");
  assert.equal(result.projection.replied,true);
  assert.equal(result.newEvents,3);
  assert.equal(result.duplicateEvents,0);
  assert.equal(result.projection.eventCount,4);
  items.forEach((item,i)=>assert.deepEqual(item.rawBody,original[i]));
  for(const field of ["approved","authorized","send","stored","authenticatedProvider"])
    assert.equal(Object.hasOwn(result,field),false);
});

test("an overridden Buffer.toString cannot substitute unsigned callback JSON",()=>{
  const accepted=signed(event("provider_accepted",1));
  const unsigned=event("provider_delivered",1);
  let methodCalls=0;
  Object.defineProperty(accepted.rawBody,"toString",{
    configurable:true,
    value(){methodCalls++;return JSON.stringify(unsigned);},
  });
  const result=project([accepted]);
  assert.equal(result.projection.delivery,"accepted");
  assert.deepEqual(result.projection.timeline.map(e=>e.kind),
    ["reserved","provider_accepted"]);
  assert.equal(methodCalls,0);
  const next=signed(event("provider_accepted",2));
  Object.defineProperty(next.rawBody,"toString",{
    configurable:true,
    value(){throw Error("Untrusted Buffer.toString invoked after HMAC verification");},
  });
  assert.throws(()=>project([accepted,next]),/Unexpected provider acceptance/);
});

test("payload mutation between HMAC verification and event projection cannot change signed meaning",()=>{
  for(const projectMode of [projectSignedSyntheticWebhookBatch, reconcileSignedSyntheticWebhookBatch]){
    const accepted=signed(event("provider_accepted",1));
    const forged=Buffer.from(JSON.stringify(event("recipient_replied",1)));
    assert.equal(forged.length,accepted.rawBody.length);
    const OriginalDecoder=globalThis.TextDecoder;
    let decodes=0;
    // Deterministically emulate an external mutation of caller-owned bytes
    // after the first decode, but before the batch reconstructs the event.
    globalThis.TextDecoder=class extends OriginalDecoder {
      decode(...args){
        const result=super.decode(...args);
        if(++decodes===1) accepted.rawBody.set(forged);
        return result;
      }
    };
    try {
      const result=projectMode(intent,reservation,[accepted],secret);
      assert.equal(result.projection.delivery,"accepted");
      assert.deepEqual(result.projection.timeline.map(e=>e.kind),
        ["reserved","provider_accepted"]);
      assert.equal(result.newEvents,1);
      assert.equal(result.duplicateEvents,0);
      assert.equal(decodes,2);
      assert.deepEqual(accepted.rawBody,forged);
    } finally {
      globalThis.TextDecoder=OriginalDecoder;
    }
  }
});

test("identical signed replay deduplicates without repeating CRM transitions",()=>{
  const accepted=signed(event("provider_accepted",1));
  const delivered=signed(event("provider_delivered",2));
  const result=project([accepted,{...accepted},delivered,{...delivered}]);
  assert.equal(result.newEvents,2);
  assert.equal(result.duplicateEvents,2);
  assert.equal(result.projection.eventCount,3);
  assert.equal(result.projection.delivery,"reported_delivered");
});

test("same ID with different signed body fails the full batch",()=>{
  const first=signed(event("provider_accepted",1));
  const conflict=signed(event("provider_delivered",2,1));
  assert.throws(()=>project([first,conflict]),/Conflicting synthetic event replay/);
});

test("bad signatures, wrong fixture keys and unsigned reserved callbacks fail",()=>{
  const good=signed(event("provider_accepted",1));
  const tampered={...good,rawBody:Buffer.from(JSON.stringify(
    event("provider_delivered",1)))};
  assert.throws(()=>project([tampered]),/Synthetic HMAC mismatch/);
  assert.throws(()=>project([good],reservation,intent,randomBytes(32)),/Synthetic HMAC mismatch/);
  assert.throws(()=>project([signed(event("reserved",1))]),/Unscoped or unsupported/);
});

test("out-of-order, missing prerequisites and cross-tenant claims fail closed",()=>{
  assert.throws(()=>project([signed(event("provider_delivered",2))]),/Unexpected provider delivery/);
  assert.throws(()=>project([signed(event("provider_accepted",2)),
    signed(event("provider_delivered",1))]),/Out-of-order/);
  assert.throws(()=>project([signed({...event("provider_accepted",1),
    organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"})]),/Unscoped/);
  assert.throws(()=>project([signed({...event("provider_accepted",1),
    recipient:"different@example.test"})]),/Unscoped/);
  const altered={...base,revision:4};
  assert.throws(()=>project([signed(event("provider_accepted",1))],
    reservation,{...altered,idempotencyKey:intent.idempotencyKey}),/Invalid simulated delivery identity/);
});

test("a later opt-out or bounce sticks in the simulated CRM projection",()=>{
  const result=project([
    signed(event("provider_accepted",1)),
    signed(event("provider_delivered",2)),
    signed(event("recipient_opted_out",3)),
    signed(event("provider_complained",4)),
  ]);
  assert.deepEqual(result.projection.suppression,["complained","opted_out"]);
  const bounced=project([signed(event("provider_accepted",1)),
    signed(event("provider_bounced",2))]);
  assert.equal(bounced.projection.delivery,"bounced");
  assert.deepEqual(bounced.projection.suppression,["bounced"]);
});

test("malformed envelopes, prototype tricks, and extra action flags fail closed",()=>{
  const good=signed(event("provider_accepted",1));
  for(const bad of [[{...good, approved:true}],[{...good, receivedAtSeconds:NaN}],
    new Array(1)]){
    assert.throws(()=>project(bad),/Invalid synthetic webhook|context/);
  }
  const marked=[good]; marked[Symbol("send")]=true;
  assert.throws(()=>project(marked),/Invalid synthetic webhook batch/);
  let calls=0;
  const accessor={...good};
  Object.defineProperty(accessor,"rawBody",{enumerable:true,get(){
    calls++; throw Error("unsafe getter");
  }});
  assert.throws(()=>project([accessor]),/Invalid synthetic webhook envelope/);
  assert.equal(calls,0);
  assert.throws(()=>project([good],{...reservation,kind:"provider_accepted"}),
    /Invalid synthetic webhook batch/);
});

test("timestamp freshness, noncanonical bytes and forged replay are rejected",()=>{
  const e=signed(event("provider_accepted",1));
  assert.throws(()=>project([{...e,receivedAtSeconds:e.receivedAtSeconds+301}]),/Stale or future/);
  const noncanonical={...e,rawBody:Buffer.concat([e.rawBody,Buffer.from("\n")])};
  assert.throws(()=>project([noncanonical]),/Synthetic HMAC mismatch/);
  assert.throws(()=>project([signed({...event("provider_accepted",1), approved:true})]),
    /Noncanonical synthetic webhook body|Unscoped or unsupported/);
});
