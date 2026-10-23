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

test("revoked consent, opt-outs, bounces and unknown suppression all block",()=>{
  for(const state of ["revoked","opted_out","bounced","unknown"]){
    const f=fixture();f.suppression.state=state;
    const result=run(f);
    assert.equal(result.state,"blocked",state);
    assert.equal(Object.hasOwn(result,"contactAuthorized"),false);
    if(state==="revoked"){
      assert.deepEqual(result.blockers,
        ["Recipient consent is explicitly revoked; do not contact"]);
    }else{
      assert.ok(result.blockers.includes("Recipient suppression is not confirmed clear"));
    }
  }
  for(const property of ["organizationId","recipient"]){
    const f=fixture();f.suppression[property]="other@example.test";
    assert.equal(run(f).state,"blocked");
  }
});

test("revocation cannot be cleared by unrelated dispatch or proposal changes",()=>{
  for(const modify of [
    f=>{f.dispatch.state="sent"},
    f=>{f.proposal.reviewState="draft"},
    f=>{f.suppression.version=999},
  ]){
    const f=fixture();
    f.suppression.state="revoked";
    modify(f);
    const result=run(f);
    assert.equal(result.state,"blocked");
    assert.ok(result.blockers.includes(
      "Recipient consent is explicitly revoked; do not contact"));
  }
  const clean=run(fixture());
  assert.deepEqual(clean,{state:"consistent-internal-only",blockers:[]});
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

test("hidden or accessor-backed reviewer receipt indexes never satisfy two-person preflight",()=>{
  for (const index of [0,1]){
    const f=fixture();
    Object.defineProperty(f.receipts,String(index),{
      value:f.receipts[index],enumerable:false,configurable:true,writable:true,
    });
    assert.equal(Object.keys(f.receipts).length,1);
    assert.throws(()=>run(f),/Invalid internal delivery preflight evidence/);
  }
  for (const index of [0,1]){
    const f=fixture();let reads=0;
    Object.defineProperty(f.receipts,String(index),{
      enumerable:true,configurable:true,get(){reads++;throw Error("unsafe receipt getter")},
    });
    assert.throws(()=>run(f),/Invalid internal delivery preflight evidence/);
    assert.equal(reads,0);
  }
  assert.deepEqual(run(fixture()),{state:"consistent-internal-only",blockers:[]});
});

test("RFC dot-atom recipient local parts reject consecutive and terminal dots",()=>{
  for(const bad of ["first..last@example.test", "first.@example.test",
    "first...last@example.test", "first..@example.test"]){
    const f=fixture();
    const {idempotencyKey, ...base}=f.intent;
    assert.throws(()=>deliveryIdempotencyKey({...base,recipient:bad}),
      /Invalid proposed delivery identity/,bad);
    f.intent.recipient=bad;
    f.proposal.recipient=bad;
    f.suppression.recipient=bad;
    assert.throws(()=>run(f),/Invalid internal delivery preflight evidence/,bad);
  }
  for(const good of ["first.last@example.test", "first+tag@example.test",
    "first.last+tag@example.test", "first_last@example.test"]){
    const f=fixture();
    const {idempotencyKey, ...base}=f.intent;
    assert.match(deliveryIdempotencyKey({...base,recipient:good}),
      /^dryrun_[0-9a-f]{64}$/,good);
  }
});

test("idempotency key distinguishes recipients, revisions and QA fingerprints",()=>{
  const {idempotencyKey, ...base}=fixture().intent;
  assert.notEqual(deliveryIdempotencyKey({...base,revision:4}),idempotencyKey);
  assert.notEqual(deliveryIdempotencyKey({...base,recipient:"other@example.test"}),idempotencyKey);
  assert.notEqual(deliveryIdempotencyKey({...base,qaSha256:"e".repeat(64)}),idempotencyKey);
  assert.throws(()=>deliveryIdempotencyKey({...base,recipient:"name@internal"}),/Invalid proposed delivery identity/);
});
