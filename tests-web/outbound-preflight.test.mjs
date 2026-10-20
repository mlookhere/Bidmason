import test from "node:test";
import assert from "node:assert/strict";
import {deliveryIdempotencyKey, evaluateDeliveryDryRun}
  from "../lib/outbound-preflight.ts";

const ids={
  organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  revision:3,sourceSha256:"a".repeat(64),policySha256:"b".repeat(64),
  contentSha256:"c".repeat(64),qaSha256:"d".repeat(64),
};
const recipient="buyer@example.test";
const actors=["cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];
function fixture(){
  const idempotencyKey=deliveryIdempotencyKey({...ids,recipient});
  return {
    intent:{...ids,recipient,idempotencyKey},
    proposal:{...ids,recipient,reviewState:"reviewed"},
    receipts:["operator","contractor"].map((role,i)=>({...ids,role,actorId:actors[i]})),
    suppression:{organizationId:ids.organizationId,recipient,state:"clear",version:4},
    dispatch:{idempotencyKey,state:"absent"},
  };
}
const run=f=>evaluateDeliveryDryRun(f.intent,f.proposal,f.receipts,f.suppression,f.dispatch);

test("matching fictional delivery evidence is consistent internally but never authorizes a send",()=>{
  const result=run(fixture());
  assert.deepEqual(result,{state:"consistent-internal-only",blockers:[]});
  assert.equal(Object.hasOwn(result,"authorized"),false);
  assert.equal(Object.hasOwn(result,"send"),false);
  assert.equal(Object.hasOwn(result,"approved"),false);
  assert.match(fixture().intent.idempotencyKey,/^dryrun_[a-f0-9]{64}$/);
});

test("content, policy, source, QA, org, recipient, and revision changes require new review",()=>{
  for(const [field,value] of [
    ["revision",4],["contentSha256","e".repeat(64)],
    ["policySha256","e".repeat(64)],["sourceSha256","e".repeat(64)],
    ["qaSha256","e".repeat(64)],
    ["organizationId","eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
    ["proposalId","eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
    ["recipient","other@example.test"],
  ]){
    const f=fixture();f.proposal[field]=value;
    const result=run(f);
    assert.equal(result.state,"blocked",field);
    assert.ok(result.blockers.some(x=>x.includes("reviewed")||x.includes("Recipient")),field);
  }
});

test("opt-outs, bounces, unknown suppressions and cross-tenant recipients block",()=>{
  for(const state of ["opted_out","bounced","unknown"]){
    const f=fixture();f.suppression.state=state;
    assert.equal(run(f).state,"blocked");
  }
  for(const property of ["organizationId","recipient"]){
    const f=fixture();f.suppression[property]="other@example.test";
    assert.equal(run(f).state,"blocked");
  }
});

test("review must be exact and represented by two different roles and actors",()=>{
  for(const mutate of [
    f=>{f.receipts[1].actorId=f.receipts[0].actorId},
    f=>{f.receipts[1].role="operator"},
    f=>{f.receipts[0].revision=4},
    f=>{f.receipts[1].qaSha256="e".repeat(64)},
    f=>{f.proposal.reviewState="revoked"},
    f=>{f.proposal.reviewState="draft"},
  ]){
    const f=fixture();mutate(f);assert.equal(run(f).state,"blocked");
  }
});

test("in-flight, sent, unknown, or mismatched idempotency reservations block replay",()=>{
  for(const state of ["reserved","sent","unknown"]){
    const f=fixture();f.dispatch.state=state;
    assert.equal(run(f).state,"blocked");
  }
  const f=fixture();f.dispatch.idempotencyKey="dryrun_"+"f".repeat(64);
  assert.equal(run(f).state,"blocked");
  const renamed=fixture();renamed.intent.idempotencyKey="dryrun_"+"f".repeat(64);
  assert.equal(run(renamed).state,"blocked");
});

test("an invalid, missing or accessor-backed evidence field fails closed",()=>{
  for(const mutate of [
    f=>{f.intent.recipient="Buyer@Example.Test"},
    f=>{f.intent.recipient="buyer@example.test\nBcc:other@example.test"},
    f=>{f.intent.organizationId="bad"},
    f=>{f.receipts=[]},
    f=>{f.receipts=[f.receipts[0],f.receipts[1],f.receipts[0]]},
    f=>{f.suppression.version=0},
    f=>{delete f.suppression.state},
    f=>{f.dispatch.state="unverified"},
    f=>{f.intent.approved=true},
    f=>Object.defineProperty(f.intent,"hidden",{value:true}),
    f=>{f.receipts[Symbol("approve")]=true},
  ]){
    const f=fixture();mutate(f);assert.throws(()=>run(f),/Invalid internal delivery preflight evidence/);
  }
  let calls=0;
  const f=fixture();
  Object.defineProperty(f.intent,"recipient",{enumerable:true,get(){
    calls++;throw Error("getter executed");
  }});
  assert.throws(()=>run(f),/Invalid internal delivery preflight evidence/);
  assert.equal(calls,0);
});

test("idempotency key distinguishes recipients, revisions and QA fingerprints",()=>{
  const base=fixture().intent;
  assert.notEqual(deliveryIdempotencyKey({...base,revision:4}),base.idempotencyKey);
  assert.notEqual(deliveryIdempotencyKey({...base,recipient:"other@example.test"}),base.idempotencyKey);
  assert.notEqual(deliveryIdempotencyKey({...base,qaSha256:"e".repeat(64)}),base.idempotencyKey);
  assert.throws(()=>deliveryIdempotencyKey({...base,recipient:"name@internal"}),/Invalid proposed delivery identity/);
});
