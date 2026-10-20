import test from "node:test";
import assert from "node:assert/strict";
import {inertEvidenceGraph, snapshotInertPolicyHistory}
 from "../lib/inert-evidence-graph.ts";

test("policy-history snapshots support valid larger revision arrays without relaxing source bounds",()=>{
 const revisions=Array.from({length:257},(_,i)=>({revision:i+1,status:"approved"}));
 assert.equal(inertEvidenceGraph(revisions),false);
 const snapshot=snapshotInertPolicyHistory(revisions);
 assert.deepEqual(snapshot,revisions);
 revisions[0].status="draft";
 assert.equal(snapshot[0].status,"approved");
});

test("policy-history snapshots refuse unbounded, accessor-backed and cyclic graphs",()=>{
 const oversized=Array.from({length:1001},()=>null);
 assert.throws(()=>snapshotInertPolicyHistory(oversized),/Unsafe company policy history/);
 let calls=0;
 const history={revisions:[{active:true}]};
 Object.defineProperty(history.revisions[0],"active",{
  enumerable:true,get(){calls++;throw Error("getter executed");}
 });
 assert.throws(()=>snapshotInertPolicyHistory(history),/Unsafe company policy history/);
 assert.equal(calls,0);
 const cycle={};cycle.self=cycle;
 assert.throws(()=>snapshotInertPolicyHistory(cycle),/Unsafe company policy history/);
});
