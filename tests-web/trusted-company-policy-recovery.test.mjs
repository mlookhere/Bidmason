import test from "node:test";
import assert from "node:assert/strict";
import {submitPolicyDraft,reviewPolicyDraft}
  from "../lib/company-policy-revisions.ts";
import {companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";
import {createTrustedCompanyPolicyRecovery}
  from "../lib/trusted-company-policy-recovery.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const submitter="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reviewer="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const another="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const session="synthetic-reviewer";
const ratecard=n=>({revision:n,pricing:{
  policyId:"synthetic-review-"+n,currency:"USD",
  minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
  services:{cleaning:{label:"Cleaning",unit:"visit",
    rateCents:12000+n,billing:"charged"}},
},tax:{method:"none",bps:0}});
function approved() {
  let history=null;
  for(let n=1;n<=2;n++){
    const previous=history?.revisions.at(-1);
    history=submitPolicyDraft(history,{organizationId:org,
      submittedBy:submitter,policy:ratecard(n),
      expectedRevision:n-1,expectedSha256:previous?.policySha256??null});
    history=reviewPolicyDraft(history,{organizationId:org,reviewedBy:reviewer,
      decision:"approve",expectedRevision:n,
      expectedSha256:history.revisions.at(-1).policySha256});
  }
  return history;
}
function record(revision,history=approved()){
 const item=history.revisions[revision-1];
 return {revision,policy_sha256:item.policySha256,policy:structuredClone(item.policy),
   submitted_by:submitter,reviewed_by:reviewer};
}
function fixture({changeAfterFirst=false,badHistory=false,badRecord=false}={}) {
 let history=approved(),head=record(1,history),actor=reviewer;
 let writes=0,queries=0,historyReads=0;
 const auth={async verifyActiveSession(value) {
   if(value!==session)throw Error("Session revoked");
   return {userId:actor};
 }};
 const store={async readAuthorized({organizationId,session:token}) {
   historyReads++;
   if(organizationId!==org||token!==session)throw Error("History denied");
   const out=structuredClone(history);
   if(badHistory)out.revisions[0].policy.pricing.policyId="tampered";
   return out;
 }};
 const db={async query(sql,params) {
   queries++;
   if(sql.includes("active_policy_heads")) {
     assert.deepEqual(params,[org,reviewer]);
     assert.ok(sql.includes("join public.bm_memberships m"));
     return {rows:[structuredClone(head)]};
   }
   if(sql.includes("from bm_intake_private.approved_policy_versions v")) {
     assert.deepEqual(params,[org,"1",reviewer]);
     const value=record(1,history);
     if(badRecord)value.policy_sha256="0".repeat(64);
     if(changeAfterFirst)head=record(2,history);
     return {rows:[value]};
   }
   writes++;throw Error("Recovery must never invoke privileged write");
 }};
 return {service:createTrustedCompanyPolicyRecovery(auth,store,db),
   get writes(){return writes;},get queries(){return queries;},
   get historyReads(){return historyReads;},
   revokeIdentity(){actor=another;},setHead(revision){head=record(revision,history);},
   corruptApproval(){history.revisions[0].reviewedBy=submitter;},
 };
}
const input={organizationId:org,reviewerSession:session,
  revision:1,policySha256:companyPolicySha256(ratecard(1))};
test("two authorized observations return matching read-only policy evidence",async()=>{
 const f=fixture();
 const result=await f.service.reconcile(input);
 assert.deepEqual(result,{state:"matching-active-at-read",
   organizationId:org,revision:1,policySha256:input.policySha256,
   observedHeadRevision:1,observedHeadSha256:input.policySha256});
 assert.equal(f.queries,4);
 assert.equal(f.historyReads,2);
 assert.equal(f.writes,0);
});
test("active head changes between reads: report changed, never claim success",async()=>{
 const f=fixture({changeAfterFirst:true});
 const result=await f.service.reconcile(input);
 assert.equal(result.state,"changed-during-read");
 assert.equal(Object.hasOwn(result,"observedHeadSha256"),false);
 assert.equal(f.writes,0);
});
test("historical approval, reviewer or private fingerprint corruption fails closed",async()=>{
 for(const [f,error] of [
   [fixture({badHistory:true}),/integrity check failed/],
   [fixture({badRecord:true}),/disagrees with stored SHA/],
   [fixture(),/No approved reviewer-owned policy/],
 ]) {
   const selector=error.source.includes("No approved")
     ? {...input,policySha256:"f".repeat(64)}:input;
   await assert.rejects(f.service.reconcile(selector),error);
   assert.equal(f.writes,0);
 }
 const denied=fixture();denied.revokeIdentity();
 await assert.rejects(denied.service.reconcile(input),
   /No approved reviewer-owned policy/);
 assert.equal(denied.writes,0);
 const forged=fixture();forged.corruptApproval();
 await assert.rejects(forged.service.reconcile(input),
   /Malformed immutable policy history/);
 assert.equal(forged.writes,0);
});
test("reject extraneous selectors before authorization or database",async()=>{
 for(const bad of [{actor:reviewer},{approved:true},
  {revision:0},{organizationId:"bad"},{policySha256:"wrong"},
  {reviewerSession:null}]) {
   const f=fixture();
   await assert.rejects(f.service.reconcile({...input,...bad}),TypeError);
   assert.equal(f.queries,0);
   assert.equal(f.writes,0);
 }
});
