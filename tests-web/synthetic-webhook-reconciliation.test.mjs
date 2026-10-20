import test from "node:test";
import assert from "node:assert/strict";
import {createHmac, randomBytes} from "node:crypto";
import {deliveryIdempotencyKey} from "../lib/outbound-preflight.ts";
import {projectSignedSyntheticWebhookBatch,
  reconcileSignedSyntheticWebhookBatch} from "../lib/synthetic-webhook-batch.ts";

const base = {
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision:3, sourceSha256:"a".repeat(64), policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64), qaSha256:"d".repeat(64),
  recipient:"buyer@example.test",
};
const intent={...base,idempotencyKey:deliveryIdempotencyKey(base)};
const secret=randomBytes(32);
const epoch=Date.parse("2026-10-20T08:00:00.000Z")/1000;
const reservation={eventId:"00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind:"reserved",
  observedAt:"2026-10-20T08:00:00.000Z"};
const event=(kind, minute, id=minute)=>({
  eventId:String(id).padStart(8,"0")+"-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organizationId:intent.organizationId,idempotencyKey:intent.idempotencyKey,
  recipient:intent.recipient,kind,
  observedAt:"2026-10-20T08:"+String(minute).padStart(2,"0")+":00.000Z",
});
const signed=(item,key=secret)=>{
  const rawBody=Buffer.from(JSON.stringify(item));
  const stamp=Math.floor(Date.parse(item.observedAt)/1000);
  return {rawBody,
    signatureHeader:"t="+stamp+",v1="+createHmac("sha256",key)
      .update("bidmason:synthetic-webhook:v1\n").update(String(stamp))
      .update("\n").update(rawBody).digest("hex"),
    receivedAtSeconds:stamp};
};
const reconcile=(envelopes,local=reservation,identity=intent,key=secret)=>
  reconcileSignedSyntheticWebhookBatch(identity,local,envelopes,key);

test("signed callbacks arriving out of order reconstruct one simulation timeline",()=>{
  const accepted=signed(event("provider_accepted",1));
  const delivered=signed(event("provider_delivered",2));
  const replied=signed(event("recipient_replied",3));
  assert.throws(()=>projectSignedSyntheticWebhookBatch(intent,reservation,
    [delivered,accepted,replied],secret),/Unexpected provider delivery/);
  const result=reconcile([delivered,accepted,replied]);
  assert.equal(result.state,"simulation-only");
  assert.equal(result.projection.delivery,"reported_delivered");
  assert.equal(result.projection.replied,true);
  assert.equal(result.newEvents,3);
  assert.equal(result.duplicateEvents,0);
  assert.equal(result.reorderedEvents,2);
  assert.deepEqual(result.projection.timeline.map(x=>x.kind),
    ["reserved","provider_accepted","provider_delivered","recipient_replied"]);
  for(const x of ["send","approved","authorized","persisted","providerAuthenticated"])
    assert.equal(Object.hasOwn(result,x),false);
});

test("identical signed replays deduplicate despite separate arrival positions",()=>{
  const accepted=signed(event("provider_accepted",1));
  const delivered=signed(event("provider_delivered",2));
  const result=reconcile([delivered,accepted,{...accepted},{...delivered}]);
  assert.equal(result.newEvents,2);
  assert.equal(result.duplicateEvents,2);
  assert.equal(result.reorderedEvents,2);
  assert.equal(result.projection.eventCount,3);
});

test("signed conflicting IDs block before any event is reprojected",()=>{
  const a=signed(event("provider_accepted",1,5));
  const b=signed(event("provider_delivered",2,5));
  assert.throws(()=>reconcile([b,a]),/Conflicting synthetic event replay/);
});

test("ties between different signed IDs and pre-reservation events are ambiguous",()=>{
  const a=signed(event("provider_accepted",1,1));
  const b=signed(event("provider_delivered",1,2));
  assert.throws(()=>reconcile([b,a]),/Ambiguous/);
  assert.throws(()=>reconcile([signed(event("provider_accepted",0,4))]),/Ambiguous/);
  const earlier={...event("provider_accepted",1),observedAt:"2026-10-20T07:59:00.000Z"};
  assert.throws(()=>reconcile([signed(earlier)]),/Ambiguous/);
});

test("missing state and invalid but signed transitions remain forbidden",()=>{
  assert.throws(()=>reconcile([signed(event("provider_delivered",2))]),/Unexpected provider delivery/);
  assert.throws(()=>reconcile([signed(event("recipient_replied",3))]),/Unexpected recipient reply/);
  assert.throws(()=>reconcile([signed(event("provider_accepted",1)),
    signed(event("provider_accepted",2))]),/Unexpected provider acceptance/);
});

test("bounce/complaint/opt-out remain sticky after reordering",()=>{
  const accepted=signed(event("provider_accepted",1));
  const delivered=signed(event("provider_delivered",2));
  const optOut=signed(event("recipient_opted_out",3));
  const complaint=signed(event("provider_complained",4));
  const result=reconcile([complaint,optOut,delivered,accepted]);
  assert.deepEqual(result.projection.suppression,["complained","opted_out"]);
  assert.equal(result.projection.delivery,"reported_delivered");
  const bounced=reconcile([signed(event("provider_bounced",2)),accepted]);
  assert.deepEqual(bounced.projection.suppression,["bounced"]);
  assert.equal(bounced.projection.delivery,"bounced");
});

test("tampering, cross-tenant or revision evidence never benefits from sorting",()=>{
  const valid=signed(event("provider_accepted",1));
  const altered={...valid,rawBody:Buffer.from(JSON.stringify(event("provider_delivered",1)))};
  assert.throws(()=>reconcile([altered]),/Synthetic HMAC mismatch/);
  assert.throws(()=>reconcile([valid],reservation,intent,randomBytes(32)),/Synthetic HMAC mismatch/);
  assert.throws(()=>reconcile([signed({...event("provider_accepted",1),
    organizationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"})]),/Unscoped/);
  assert.throws(()=>reconcile([signed({...event("provider_accepted",1),
    recipient:"cross-tenant@example.test"})]),/Unscoped/);
  assert.throws(()=>reconcile([valid],reservation,{...intent,revision:4}),/Invalid simulated delivery identity/);
});

test("malformed inputs, future dates and oversized batches fail closed",()=>{
  const valid=signed(event("provider_accepted",1));
  assert.throws(()=>reconcile([{...valid,receivedAtSeconds:valid.receivedAtSeconds+301}]),/Stale or future/);
  assert.throws(()=>reconcile(new Array(1)),/Invalid synthetic webhook batch/);
  assert.throws(()=>reconcile(Array(101).fill(valid)),/Invalid synthetic webhook batch/);
  assert.throws(()=>reconcile([valid],{...reservation,kind:"provider_accepted"}),/Invalid synthetic webhook batch/);
  const poison={...valid};
  let reads=0;
  Object.defineProperty(poison,"signatureHeader",{enumerable:true,get(){reads++;throw Error("getter")}});
  assert.throws(()=>reconcile([poison]),/Invalid synthetic webhook envelope/);
  assert.equal(reads,0);
});
