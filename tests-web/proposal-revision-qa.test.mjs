import test from "node:test";
import assert from "node:assert/strict";
import {buildProposalQaReport, evaluateProposalReceiptConsistency, evaluateSyntheticArtifactQaConsistency}
  from "../lib/proposal-revision-qa.ts";

const A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SHA=(x)=>x.repeat(64);
const base={organizationId:A,proposalId:B,revision:3,
 sourceSha256:SHA("a"),policySha256:SHA("b"),contentSha256:SHA("c")};
const names=["pricing","scope","claims","recipient","pdf-layout"];
const observations=()=>names.map(check=>({check,state:"passed",evidenceSha256:SHA("d"),note:""}));
const receipts=(r)=>["operator","contractor"].map((role,i)=>({
 ...r.identity,qaSha256:r.qaSha256,role,actorId:i===0?C:D,
}));

test("complete QA is internal only; two independent revision-matched receipts are consistent",()=>{
 const report=buildProposalQaReport(base, observations());
 assert.equal(report.state,"internal-qa-only");
 assert.equal(report.status,"passed");
 assert.equal(report.checks.length,5);
 assert.match(report.qaSha256,/^[a-f0-9]{64}$/);
 const result=evaluateProposalReceiptConsistency(report,receipts(report));
 assert.equal(result.state,"consistent-internal-only");
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"deliver"),false);
 assert.equal(buildProposalQaReport(base,observations()).qaSha256,report.qaSha256);
});

test("missing, failed, or not_run checks cannot be treated as green",()=>{
 for(const rows of [
  [],observations().slice(1),
  observations().map((x,i)=>i===0?{...x,state:"failed",evidenceSha256:null,note:"Wrong total"}:x),
  observations().map((x,i)=>i===1?{...x,state:"not_run",evidenceSha256:null,note:"Not tested"}:x),
 ]){
  const report=buildProposalQaReport(base,rows);
  assert.equal(report.status,"blocked");
  assert.equal(evaluateProposalReceiptConsistency(report,receipts(report)).state,"blocked");
 }
});

test("changed revision, source, ratecard, content or QA receipt invalidates prior review",()=>{
 const before=buildProposalQaReport(base,observations());
 for(const field of ["revision","sourceSha256","policySha256","contentSha256"]){
  const next={...base,[field]:field==="revision"?4:SHA("e")};
  const report=buildProposalQaReport(next,observations());
  assert.notEqual(report.qaSha256,before.qaSha256);
  assert.equal(evaluateProposalReceiptConsistency(report,receipts(before)).state,"blocked");
 }
 const changedChecks=observations();
 changedChecks[0].evidenceSha256=SHA("f");
 const changed=buildProposalQaReport(base,changedChecks);
 assert.equal(evaluateProposalReceiptConsistency(changed,receipts(before)).state,"blocked");
});

test("missing, repeated, self-signed, or foreign receipts cannot satisfy two-person review",()=>{
 const report=buildProposalQaReport(base,observations());
 const pair=receipts(report);
 const variants=[[],pair.slice(0,1),[pair[0],pair[0]],
  [pair[0],{...pair[1],actorId:C}],
  [pair[0],{...pair[1],organizationId:B}],
  [pair[0],{...pair[1],role:"operator"}]];
 for(const value of variants)
  assert.equal(evaluateProposalReceiptConsistency(report,value).state,"blocked");
});

test("malformed or forged observations, evidence and reports fail closed",()=>{
 assert.throws(()=>buildProposalQaReport(base,[observations()[0],observations()[0]]),/Duplicate/);
 for(const value of [
  {...observations()[0],unknownApproval:true},
  {...observations()[0],evidenceSha256:null},
  {...observations()[0],state:"not_run",note:"",evidenceSha256:null},
  {...observations()[0],state:"failed",note:"Need review"},
 ]){
  assert.throws(()=>buildProposalQaReport(base,[value]),/Malformed/);
 }
 const report=buildProposalQaReport(base,observations());
 assert.throws(()=>evaluateProposalReceiptConsistency({...report,qaSha256:SHA("0")},receipts(report)),/integrity/);
 assert.throws(()=>evaluateProposalReceiptConsistency({...report,status:"blocked"},receipts(report)),/integrity/);
 const unsafe={...base};
 let calls=0;
 Object.defineProperty(unsafe,"proposalId",{enumerable:true,get(){
  calls++;throw new Error("Getter executed");
 }});
 assert.throws(()=>buildProposalQaReport(unsafe,observations()),/Invalid proposal revision identity/);
 const malicious=observations();
 Object.defineProperty(malicious[0],"state",{enumerable:true,get(){
  calls++;throw new Error("Getter executed");
 }});
 assert.throws(()=>buildProposalQaReport(base,malicious),/Malformed/);
 assert.equal(calls,0);
});

test("QA observations reject sparse or decorated arrays, symbols and hidden fields",()=>{
 for(const mutate of [
  arr=>{delete arr[0]},
  arr=>{arr[Symbol("approve")]=true},
  arr=>Object.defineProperty(arr,"hidden",{value:true}),
 ]){
  const rows=observations();mutate(rows);
  assert.throws(()=>buildProposalQaReport(base,rows),/Invalid proposal QA observations/);
 }
});


test("synthetic PDF digest must agree with exact internal QA and review receipts",()=>{
 const pdfSha=SHA("e");
 const checks=observations().map(x=>x.check==="pdf-layout"
  ? {...x,evidenceSha256:pdfSha}:x);
 const report=buildProposalQaReport(base,checks);
 const manifest={
  format:"synthetic-proposal-integrity-v1",
  disposition:"INTERNAL ONLY - NOT FOR DELIVERY",reference:"SYN-PAINT-001",
  revision:3,snapshotSha256:base.contentSha256,pdfSha256:pdfSha,
  pdfBytes:14000,pageCount:5,
 };
 assert.equal(evaluateSyntheticArtifactQaConsistency(report,receipts(report),manifest).state,
  "consistent-internal-only");
 assert.equal(Object.hasOwn(evaluateSyntheticArtifactQaConsistency(report,receipts(report),manifest),"approved"),false);
 for(const partial of [
  {revision:4},{snapshotSha256:SHA("f")},{pdfSha256:SHA("f")},
  {pdfBytes:0},{pdfBytes:true},{pageCount:0},{pageCount:9},
  {pageCount:5.5},{format:"approved"},{disposition:"DELIVERABLE"},
  {reference:"CUSTOMER-001"},{approved:true},
 ]) {
  assert.equal(evaluateSyntheticArtifactQaConsistency(report,receipts(report),
   {...manifest,...partial}).state,"blocked");
 }
 const stale={...base,revision:4};
 const newer=buildProposalQaReport(stale,checks);
 assert.equal(evaluateSyntheticArtifactQaConsistency(newer,receipts(report),manifest).state,"blocked");
 assert.equal(evaluateSyntheticArtifactQaConsistency(report,receipts(report).slice(0,1),manifest).state,"blocked");
 const missing=buildProposalQaReport(base,checks.filter(x=>x.check!=="pdf-layout"));
 assert.equal(evaluateSyntheticArtifactQaConsistency(missing,receipts(missing),manifest).state,"blocked");
 let called=0;
 const hostile={...manifest};
 Object.defineProperty(hostile,"pdfSha256",{enumerable:true,get(){called++;throw Error("executed");}});
 assert.equal(evaluateSyntheticArtifactQaConsistency(report,receipts(report),hostile).state,"blocked");
 assert.equal(called,0);
 const symbol={...manifest}; symbol[Symbol("publish")]=true;
 assert.equal(evaluateSyntheticArtifactQaConsistency(report,receipts(report),symbol).state,"blocked");
});
