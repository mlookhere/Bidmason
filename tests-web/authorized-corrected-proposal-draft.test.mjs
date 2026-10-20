import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {prepareExtractionCorrectionDraft} from "../lib/extraction-correction-draft.ts";
import {submitPolicyDraft,reviewPolicyDraft} from "../lib/company-policy-revisions.ts";
import {readExtractionCorrectionContext,commitAuthorizedExtractionCorrection,
 readExtractionActivationContext,commitAuthorizedExtractionActivation}
 from "../lib/tenant-extraction-correction.ts";
import {readCorrectedScopeContext,commitAuthorizedCorrectedScopeReview}
 from "../lib/tenant-corrected-scope-review.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE="11111111-1111-4111-8111-111111111111";
const WRITER="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTIVATOR="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REVIEWER="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const APPROVER="ffffffff-ffff-4fff-8fff-ffffffffffff";
const original={kind:"typed-note",text:"Clean 2 rooms; polish floors"};
const first={serviceCode:"rooms",units:2,start:0,end:13,excerpt:"Clean 2 rooms"};
const second={serviceCode:"floor",units:1,start:15,end:28,excerpt:"polish floors"};
const changes=[{action:"replace",index:0,candidate:{...first,units:3},
 reason:"Checked the work order and verified three rooms"}];
const selector={organizationId:ORG,sourceId:SOURCE};
const policy=n=>({revision:n,pricing:{policyId:"clean-"+n,currency:"USD",
 minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
 services:{rooms:{label:"Room cleaning",unit:"room",rateCents:7000,billing:"charged"},
 floor:{label:"Floor care",unit:"job",rateCents:2000,billing:"charged",optionalAddon:true}}},
 tax:{method:"none",bps:0}});
function history(n=1){
 let h=null;
 for(let i=1;i<=n;i++){
  h=submitPolicyDraft(h,{organizationId:ORG,submittedBy:WRITER,
   expectedRevision:i-1,expectedSha256:h?.revisions.at(-1)?.policySha256??null,
   policy:policy(i)});
  h=reviewPolicyDraft(h,{organizationId:ORG,reviewedBy:APPROVER,
   decision:"approve",expectedRevision:i,
   expectedSha256:h.revisions.at(-1).policySha256});
 }
 return h;
}
function fixture(){
 const review=prepareExtractionReview(original,[first,second]);
 let record={organizationId:ORG,sourceId:SOURCE,revision:2,
  original:structuredClone(original),review:structuredClone(review),
  extractionAudit:[{sourceRevision:2,actorId:WRITER,
   sourceSha256:review.sourceSha256,candidatesSha256:review.candidatesSha256}],
  scopeReview:null,pendingCorrection:null,activatedCorrection:null,correctedScopeReview:null};
 let active=history(),queue=Promise.resolve(),reads=0,writes=0;
 let afterWrite=()=>{},afterPolicy=()=>{},afterRead=()=>{};
 const sessions=new Map([
  ["corrector",{org:ORG,actor:WRITER,perm:"correct-extraction"}],
  ["activator",{org:ORG,actor:ACTIVATOR,perm:"activate-extraction-correction"}],
  ["reviewer",{org:ORG,actor:REVIEWER,perm:"review-corrected-extraction"}],
  ["viewer",{org:ORG,actor:REVIEWER,perm:"none"}],
  ["foreign",{org:FOREIGN,actor:REVIEWER,perm:"review-corrected-extraction"}]]);
 const auth=(session,org,perm)=>{const role=sessions.get(session);
  if(!role||role.org!==org||(perm&&role.perm!==perm))throw Error("Unauthorized");
  return role.actor;};
 const store={
  async readAuthorized({session,organizationId,sourceId}){
   reads++;auth(session,organizationId);afterRead();
   return sourceId===SOURCE?structuredClone(record):null;
  },
  mutateAuthorized({session,organizationId,sourceId,permission,transform}){
   const task=queue.catch(()=>{}).then(()=>{writes++;
    const actor=auth(session,organizationId,permission);
    const next=transform(sourceId===SOURCE?structuredClone(record):null,actor);
    record=structuredClone(next);afterWrite();
    return structuredClone(next);
   });
   queue=task.then(()=>{},()=>{});return task;
  },
 };
 const policyStore={async readAuthorized({session,organizationId}){
  auth(session,organizationId);afterPolicy();
  return structuredClone(active);
 }};
 return {store,policyStore,get:()=>structuredClone(record),
  update:fn=>{const v=structuredClone(record);fn(v);record=v;},
  setPolicy:n=>{active=history(n)},sessions,
  hooks:{write:fn=>afterWrite=fn,policy:fn=>afterPolicy=fn,read:fn=>afterRead=fn},
  counts:()=>({reads,writes})};
}
async function activated(f){
 const orig=await readExtractionCorrectionContext(f.store,"corrector",selector);
 const draft=prepareExtractionCorrectionDraft(original,f.get().review,changes);
 await commitAuthorizedExtractionCorrection(f.store,"corrector",{
  ...selector,expectedRevision:orig.expectedRevision,
  expectedSnapshotSha256:orig.expectedSnapshotSha256,
  expectedCorrectionSha256:draft.correctionSha256,changes});
 const ctx=await readExtractionActivationContext(f.store,"activator",selector);
 await commitAuthorizedExtractionActivation(f.store,"activator",{
  ...selector,expectedRevision:ctx.expectedRevision,
  expectedSnapshotSha256:ctx.expectedSnapshotSha256,
  expectedCorrectionSha256:ctx.expectedCorrectionSha256});
}
async function request(f,extra={}){
 const ctx=await readCorrectedScopeContext(f.store,f.policyStore,"reviewer",selector);
 return {...selector,expectedRevision:ctx.expectedRevision,
  expectedSnapshotSha256:ctx.expectedSnapshotSha256,
  activationSha256:ctx.activationSha256,
  reviewKey:ctx.model.key,selectedIndices:[0],acceptedAddonCodes:[],...extra};
}

import {readAuthorizedCorrectedProposalDraftPreview}
 from "../lib/authorized-corrected-proposal-draft.ts";
import {readAuthorizedProposalDraftPreview}
 from "../lib/authorized-proposal-draft.ts";

async function reviewed(f,more={}) {
 await activated(f);
 const req=await request(f,more);
 await commitAuthorizedCorrectedScopeReview(f.store,f.policyStore,"reviewer",req);
}
const draft=(f,source=f.store,policies=f.policyStore,session="reviewer")=>
 readAuthorizedCorrectedProposalDraftPreview(source,policies,session,selector);

test("read-only corrected draft uses corrected quantities and no proposal permission",async()=>{
 const f=fixture();await reviewed(f);
 const stored=f.get();
 const result=await draft(f);
 assert.equal(result.state,"preview-only");
 assert.equal(result.purpose,"internal-corrected-proposal-draft");
 assert.equal(result.sourceRevision,5);
 assert.equal(result.reviewedBy,REVIEWER);
 assert.equal(result.preview.selectedServices[0].units,3);
 assert.equal(result.preview.economics.quote.totalCents,21000);
 assert.equal(result.preview.economics.policyRevision,1);
 assert.match(result.draftSnapshotSha256,/^[a-f0-9]{64}$/);
 assert.equal(result.activationSha256,stored.activatedCorrection.activationSha256);
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
 assert.equal(Object.hasOwn(result,"customerProposal"),false);
 assert.deepEqual(f.get(),stored);
 await assert.rejects(readAuthorizedProposalDraftPreview(
  f.store,f.policyStore,"reviewer",selector),/No valid committed human service review/);
});

test("selected optional corrected addon retains explicit human acknowledgement",async()=>{
 const f=fixture();
 await reviewed(f,{selectedIndices:[0,1],acceptedAddonCodes:["floor"]});
 const result=await draft(f);
 assert.deepEqual(result.preview.selectedServices.map(s=>s.serviceCode),["rooms","floor"]);
 assert.equal(result.preview.selectedServices[1].addonAccepted,true);
 assert.equal(result.preview.economics.quote.totalCents,23000);
});

test("uncommitted and activated-but-unreviewed corrections cannot preview",async()=>{
 const f=fixture();
 await assert.rejects(draft(f),/No valid renewed human/);
 await activated(f);
 await assert.rejects(draft(f),/No valid renewed human/);
 const req=await request(f);
 await commitAuthorizedCorrectedScopeReview(f.store,f.policyStore,"reviewer",req);
 assert.equal((await draft(f)).state,"preview-only");
});

test("altered reviewed selections, digests and immutable corrections fail closed",async()=>{
 const mutations=[
  row=>{row.correctedScopeReview.selectedIndices=[1]},
  row=>{row.correctedScopeReview.reviewedSelectionSha256="a".repeat(64)},
  row=>{row.correctedScopeReview.policySha256="b".repeat(64)},
  row=>{row.correctedScopeReview.activationSha256="c".repeat(64)},
  row=>{row.correctedScopeReview.approved=true},
  row=>{row.correctedScopeReview.reviewedBy="not-a-uuid"},
  row=>{row.activatedCorrection.correctedReview.candidates[0].units=2},
  row=>{row.activatedCorrection.priorCorrection.changes[0].reason="forged"},
  row=>{row.review.candidates[0].units=99},
  row=>{row.original.text+=" changed"},
  row=>{row.scopeReview={approved:true}},
  row=>{row.revision++},
 ];
 for(const mutate of mutations){
  const f=fixture();await reviewed(f);
  f.update(mutate);
  await assert.rejects(draft(f));
 }
});

test("new approved company ratecard invalidates the corrected scope before pricing",async()=>{
 const f=fixture();await reviewed(f);f.setPolicy(2);
 await assert.rejects(draft(f),/stale correction or company pricing/);
});

test("second source read detects evidence changes with no new writes",async()=>{
 const f=fixture();await reviewed(f);
 const writes=f.counts().writes;
 let reads=0;
 const source={readAuthorized:async input=>{
  const record=await f.store.readAuthorized(input);
  if(++reads===1)f.update(row=>{row.correctedScopeReview.selectedIndices=[1]});
  return record;
 }};
 await assert.rejects(draft(f,source),/evidence changed/);
 assert.equal(f.counts().writes,writes);
});

test("second policy read detects change in approved company pricing",async()=>{
 const f=fixture();await reviewed(f);
 let reads=0;
 const policyStore={readAuthorized:async input=>{
  const prior=await f.policyStore.readAuthorized(input);
  if(++reads===1)f.setPolicy(2);
  return prior;
 }};
 await assert.rejects(draft(f,f.store,policyStore),/pricing changed during corrected draft/);
});

test("revoked and cross-tenant sessions cannot read corrected proposals",async()=>{
 const f=fixture();await reviewed(f);
 await assert.rejects(draft(f,f.store,f.policyStore,"foreign"),/Unauthorized/);
 let reads=0;
 const source={readAuthorized:async input=>{
  const record=await f.store.readAuthorized(input);
  if(++reads===1)f.sessions.delete("reviewer");
  return record;
 }};
 await assert.rejects(draft(f,source),/Unauthorized/);
});

test("equal authorized evidence yields repeatable fingerprint without mutations",async()=>{
 const f=fixture();await reviewed(f);
 const writes=f.counts().writes;
 const one=await draft(f),two=await draft(f);
 assert.equal(one.draftSnapshotSha256,two.draftSnapshotSha256);
 assert.deepEqual(one.preview,two.preview);
 assert.equal(f.counts().writes,writes);
});

test("extra selector keys and getter-backed IDs are rejected before data access",async()=>{
 const f=fixture();await reviewed(f);
 const hidden={...selector};Object.defineProperty(hidden,"send",{value:true});
 let calls=0;
 const getter={...selector};Object.defineProperty(getter,"sourceId",{
  enumerable:true,get(){calls++;return SOURCE},
 });
 await assert.rejects(readAuthorizedCorrectedProposalDraftPreview(
  f.store,f.policyStore,"reviewer",hidden),/Invalid corrected proposal draft selector/);
 await assert.rejects(readAuthorizedCorrectedProposalDraftPreview(
  f.store,f.policyStore,"reviewer",getter),/Invalid corrected proposal draft selector/);
 assert.equal(calls,0);
});


test("corrected proposal preview keeps original source across both reads",async()=>{
 const f=fixture();await reviewed(f);
 const baseline=await draft(f),mutable={...selector};
 let calls=0;
 const proxy={readAuthorized:async input=>{
  const found=await f.store.readAuthorized(input);
  if(++calls===1){
   mutable.organizationId=FOREIGN;
   mutable.sourceId="22222222-2222-4222-8222-222222222222";
  }
  return found;
 }};
 const result=await readAuthorizedCorrectedProposalDraftPreview(
  proxy,f.policyStore,"reviewer",mutable);
 assert.equal(calls,2);
 assert.equal(result.organizationId,ORG);
 assert.equal(result.sourceId,SOURCE);
 assert.equal(result.draftSnapshotSha256,baseline.draftSnapshotSha256);
 assert.deepEqual(result.preview,baseline.preview);
});

test("corrected proposal selector rejects inherited or symbol approval directives before source lookup",async()=>{
 const f=fixture();await reviewed(f);
 const inherited=Object.assign(Object.create({approved:true}),selector);
 const symbolic={...selector};
 symbolic[Symbol("send")]=true;
 let calls=0;
 const proxy={readAuthorized:async input=>{
  calls++;return f.store.readAuthorized(input);
 }};
 for(const invalid of [inherited,symbolic]){
  await assert.rejects(readAuthorizedCorrectedProposalDraftPreview(
   proxy,f.policyStore,"reviewer",invalid),
   /Invalid corrected proposal draft selector/);
 }
 assert.equal(calls,0);
});


test("hostile corrected draft readback cannot execute stored getters or custom serializers",async()=>{
 const f=fixture();await reviewed(f);
 const baseline=f.get();
 let getters=0,policyReads=0,sourceReads=0;
 const policies={readAuthorized:async()=>{policyReads++;
  throw Error("Unexpected company policy lookup");}};
 const mutations=[
  row=>Object.defineProperty(row,"organizationId",{enumerable:true,
   get(){getters++;throw Error("Unsafe organization getter");}}),
  row=>Object.defineProperty(row,"correctedScopeReview",{enumerable:true,
   get(){getters++;throw Error("Unsafe corrected scope getter");}}),
  row=>Object.defineProperty(row.correctedScopeReview,"reviewedBy",{enumerable:true,
   get(){getters++;throw Error("Unsafe reviewer getter");}}),
  row=>Object.defineProperty(row.correctedScopeReview.selectedIndices,"0",{
   enumerable:true,get(){getters++;throw Error("Unsafe selection index");}}),
  row=>{delete row.correctedScopeReview.selectedIndices[0];},
  row=>{row.correctedScopeReview.acceptedAddonCodes[Symbol("send")]=true;},
  row=>Object.setPrototypeOf(row.correctedScopeReview.selectedIndices,
   Object.create(Array.prototype)),
  row=>Object.defineProperty(row.activatedCorrection.priorCorrection,"toJSON",{
   enumerable:true,value(){getters++;throw Error("Unsafe serializer");}}),
  row=>Object.defineProperty(row.activatedCorrection.correctedReview.candidates,"0",{
   enumerable:true,get(){getters++;throw Error("Unsafe candidate index");}}),
  row=>Object.defineProperty(row.extractionAudit[0],"actorId",{enumerable:true,
   get(){getters++;throw Error("Unsafe audit actor");}}),
  row=>Object.defineProperty(row.review.candidates[0],"hiddenApproval",{value:true}),
  row=>{row[Symbol("approve")]=true;},
  row=>{row.correctedScopeReview.next=row.correctedScopeReview;},
  row=>{row.correctedScopeReview.policyRevision=Number.POSITIVE_INFINITY;},
 ];
 for(const mutate of mutations){
  const stored=structuredClone(baseline);mutate(stored);
  const source={readAuthorized:async()=>{sourceReads++;return stored;}};
  await assert.rejects(draft(f,source,policies),
   /Unsafe corrected proposal evidence/);
 }
 assert.equal(sourceReads,mutations.length);
 assert.equal(policyReads,0);
 assert.equal(getters,0);
});

test("unsafe evidence introduced only on second corrected draft read fails closed",async()=>{
 const f=fixture();await reviewed(f);
 let reads=0,getters=0,policyReads=0;
 const source={async readAuthorized(input){
  const record=await f.store.readAuthorized(input);
  if(++reads===2){
   Object.defineProperty(record.correctedScopeReview,"toJSON",{
    enumerable:true,value(){getters++;throw Error("Unsafe late serializer");}});
  }
  return record;
 }};
 const policies={readAuthorized:async input=>{
  policyReads++;return f.policyStore.readAuthorized(input);
 }};
 await assert.rejects(draft(f,source,policies),
  /Unsafe corrected proposal evidence/);
 assert.equal(reads,2);
 assert.equal(policyReads,1);
 assert.equal(getters,0);
});

test("corrected draft snapshots each source read before its asynchronous policy lookup",async()=>{
 for(const phase of [1,2]) {
  const f=fixture();await reviewed(f);
  let reads=0,policyReads=0,getters=0,mutable;
  const source={readAuthorized:async input=>{
   const current=await f.store.readAuthorized(input);
   if(++reads===phase)mutable=current;
   return current;
  }};
  const policies={readAuthorized:async input=>{
   if(++policyReads===phase){
    if(phase===1){
     Object.defineProperty(mutable.correctedScopeReview,"reviewedBy",{
      enumerable:true,get(){getters++;throw Error("async mutation getter");}
     });
    }else{
     Object.defineProperty(mutable.original,"text",{
      enumerable:true,get(){getters++;throw Error("late source getter");}
     });
    }
   }
   return f.policyStore.readAuthorized(input);
  }};
  const result=await draft(f,source,policies);
  assert.equal(result.purpose,"internal-corrected-proposal-draft");
  assert.equal(reads,2);
  assert.equal(policyReads,2);
  assert.equal(getters,0);
 }
});

test("corrected proposal draft rejects unsafe company history on either authorized read",async()=>{
 const tamper=[
  (history,hit)=>Object.defineProperty(history,"activeRevision",{
   enumerable:true,get(){hit();throw Error("Executed company history getter");}}),
  (history,hit)=>Object.defineProperty(
   history.revisions[0].policy.pricing.services.rooms,"rateCents",{
   enumerable:true,get(){hit();throw Error("Executed company rate getter");}}),
  (history,hit)=>Object.defineProperty(history.revisions[0].policy,"toJSON",{
   enumerable:true,value(){hit();throw Error("Executed company serializer");}}),
  history=>{history.revisions[Symbol("release")]=true;},
  history=>{Object.defineProperty(history.revisions[0],"hiddenApproval",{value:true});},
 ];
 for(const phase of [1,2]){
  for(const mutate of tamper){
   const f=fixture();await reviewed(f);
   let reads=0,executions=0;
   const policies={readAuthorized:async input=>{
    const record=await f.policyStore.readAuthorized(input);
    if(++reads===phase)mutate(record,()=>{executions++;});
    return record;
   }};
   await assert.rejects(draft(f,f.store,policies),/Unsafe company policy history/);
   assert.equal(reads,phase);
   assert.equal(executions,0);
  }
 }
});
