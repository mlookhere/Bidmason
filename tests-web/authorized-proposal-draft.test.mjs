import {readAuthorizedProposalDraftPreview} from '../lib/authorized-proposal-draft.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareExtractionReview} from '../lib/intake-review.ts';
import {submitPolicyDraft,reviewPolicyDraft} from '../lib/company-policy-revisions.ts';
import {readServiceReviewContext,commitAuthorizedServiceReview} from '../lib/tenant-service-review.ts';

const ORG='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE='11111111-1111-4111-8111-111111111111';
const AUTHOR='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REVIEWER='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORIGINAL={kind:'typed-note',text:'Clean office, add carpet'};
const candidates=[
 {serviceCode:'office',units:1,excerpt:'Clean office',start:0,end:12},
 {serviceCode:'carpet',units:1,excerpt:'add carpet',start:14,end:24},
];
const policy=(revision=1)=>({revision,pricing:{policyId:'clean-'+revision,currency:'USD',
 minimum:{rule:'quote',cents:12000},calculationOrder:'discount-then-surcharge',
 services:{office:{label:'Office',unit:'job',rateCents:7000,billing:'charged'},
 carpet:{label:'Carpet',unit:'job',rateCents:4000,billing:'charged',optionalAddon:true}}},
 tax:{method:'none',bps:0}});
function approved(revision=1) {
 let history=null;
 for(let n=1;n<=revision;n++){
  const prior=history?.revisions.at(-1);
  history=submitPolicyDraft(history,{organizationId:ORG,submittedBy:AUTHOR,policy:policy(n),
    expectedRevision:n-1,expectedSha256:prior?.policySha256??null});
  history=reviewPolicyDraft(history,{organizationId:ORG,reviewedBy:REVIEWER,
    decision:'approve',expectedRevision:n,expectedSha256:history.revisions.at(-1).policySha256});
 }
 return history;
}
function fixture(){
 const review=prepareExtractionReview(ORIGINAL,candidates);
 let current={organizationId:ORG,sourceId:SOURCE,revision:2,original:ORIGINAL,
   review,extractionAudit:[{sourceRevision:2,actorId:AUTHOR,
     sourceSha256:review.sourceSha256,candidatesSha256:review.candidatesSha256}],
   scopeReview:null};
 let history=approved(), reads=0,mutations=0;
 const memberships=new Map([['reviewer',{org:ORG,actor:REVIEWER,review:true}],
  ['viewer',{org:ORG,actor:AUTHOR,review:false}],['foreign',{org:OTHER,actor:REVIEWER,review:true}]]);
 let beforeMutate=()=>{},afterMutate=()=>{},beforePolicyRead=()=>{};
 function auth(session,org,write=false){const m=memberships.get(session);
  if(!m||m.org!==org||(write&&!m.review))throw Error('Unauthorized scope review');return m.actor;}
 let queue=Promise.resolve();
 const sourceStore={
   async readAuthorized({session,organizationId,sourceId}){reads++;auth(session,organizationId);
     return sourceId===SOURCE?structuredClone(current):null;},
   mutateAuthorized({session,organizationId,sourceId,permission,transform}){
     const task=queue.catch(()=>{}).then(()=>{mutations++;beforeMutate();
      if(permission!=='review-extraction')throw Error('Unauthorized scope permission');
      const actor=auth(session,organizationId,true);
      const result=transform(sourceId===SOURCE?structuredClone(current):null,actor);
      current=structuredClone(result);afterMutate();return structuredClone(result);
     });queue=task.then(()=>{},()=>{});return task;
   }
 };
 const policyStore={async readAuthorized({session,organizationId}){
   beforePolicyRead();auth(session,organizationId);return structuredClone(history);}};
 return {sourceStore,policyStore,memberships,get:()=>structuredClone(current),
   put:x=>current=structuredClone(x),setHistory:x=>history=structuredClone(x),
   hooks:(a=()=>{},b=()=>{},c=()=>{})=>{beforeMutate=a;afterMutate=b;beforePolicyRead=c},
   counts:()=>({reads,mutations})};
}
const selector={organizationId:ORG,sourceId:SOURCE};
async function request(f,extra={}){const ctx=await readServiceReviewContext(f.sourceStore,f.policyStore,'reviewer',selector);
 return {...selector,expectedRevision:ctx.expectedRevision,expectedSnapshotSha256:ctx.expectedSnapshotSha256,
 reviewKey:ctx.model.key,selectedIndices:[0],acceptedAddonCodes:[],...extra};}



async function committed(f, opts={}) {
 const req=await request(f,opts);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 return req;
}
const readDraft=(f,session='reviewer',key=selector)=>readAuthorizedProposalDraftPreview(
 f.sourceStore,f.policyStore,session,key);

test('committed scope yields a deterministic internal-only pricing draft preview',async()=>{
 const f=fixture();await committed(f);
 const result=await readDraft(f);
 assert.equal(result.state,'preview-only');
 assert.equal(result.purpose,'internal-proposal-draft');
 assert.equal(result.sourceRevision,3);
 assert.equal(result.reviewedBy,REVIEWER);
 assert.equal(result.preview.state,'preview-only');
 assert.equal(result.preview.economics.quote.totalCents,12000);
 assert.deepEqual(result.preview.selectedServices.map(x=>x.serviceCode),['office']);
 assert.match(result.draftSnapshotSha256,/^[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(result,'approved'),false);
 assert.equal(Object.hasOwn(result,'send'),false);
 assert.equal(Object.hasOwn(result,'publish'),false);
 assert.equal(f.counts().mutations,1);
});
test('human-accepted add-on alone enters preview, with exact company minimum',async()=>{
 const f=fixture();await committed(f,{selectedIndices:[0,1],acceptedAddonCodes:['carpet']});
 const result=await readDraft(f);
 assert.deepEqual(result.preview.selectedServices.map(x=>x.serviceCode),['office','carpet']);
 assert.equal(result.preview.selectedServices[1].addonAccepted,true);
 assert.equal(result.preview.economics.quote.totalCents,12000);
});
test('draft preview requires a durably committed review',async()=>{
 const f=fixture();
 await assert.rejects(readDraft(f),/No valid committed human service review/);
});
test('new approved pricing revision invalidates the earlier reviewed selection',async()=>{
 const f=fixture();await committed(f);f.setHistory(approved(2));
 await assert.rejects(readDraft(f),/stale company ratecard/);
});
test('mutating reviewed selection, reviewer, policy hashes or adding send fields fails',async()=>{
 for(const mutate of [
  x=>{x.scopeReview.reviewedBy='fake'},
  x=>{x.scopeReview.selectedIndices=[1]},
  x=>{x.scopeReview.acceptedAddonCodes=['carpet']},
  x=>{x.scopeReview.reviewedSelectionSha256='0'.repeat(64)},
  x=>{x.scopeReview.policySha256='0'.repeat(64)},
  x=>{x.scopeReview.reviewKey='0'.repeat(64)},
  x=>{x.scopeReview.quoteTotalCents=1},
  x=>{x.scopeReview.send=true},
 ]){
  const f=fixture();await committed(f);
  const row=f.get();mutate(row);f.put(row);
  await assert.rejects(readDraft(f));
 }
});
test('forged original, candidate and extraction audit cannot enter internal draft',async()=>{
 for(const mutate of [
  x=>{x.original.text+=' changed'},
  x=>{x.review.candidates[0].units=999},
  x=>{x.extractionAudit[0].sourceSha256='0'.repeat(64)},
  x=>{x.extractionAudit[0].sourceRevision=3},
  x=>{x.revision+=1},
  x=>{x.extractionAudit[0].actorId='impostor'},
 ]){
  const f=fixture();await committed(f);
  const row=f.get();mutate(row);f.put(row);
  await assert.rejects(readDraft(f));
 }
});
test('cross-tenant, lost access, or invalid selector never returns customer scope',async()=>{
 const f=fixture();await committed(f);
 await assert.rejects(readDraft(f,'foreign'),/Unauthorized/);
 await assert.rejects(readDraft(f,'none'),/Unauthorized/);
 for(const key of [
  {organizationId:'bad',sourceId:SOURCE},
  {organizationId:ORG,sourceId:'../other'},
  {...selector,send:true},
  {...selector,approved:true},
 ]){
  await assert.rejects(readDraft(f,'reviewer',key),/Invalid internal proposal draft selector/);
 }
});
test('source altered between first and second authorized reads fails closed',async()=>{
 const f=fixture();await committed(f);
 let n=0;
 const source={async readAuthorized(input){
  const snapshot=await f.sourceStore.readAuthorized(input);
  if(++n===1){const r=f.get();r.original.text+=' late edit';f.put(r);}
  return snapshot;
 }};
 await assert.rejects(readAuthorizedProposalDraftPreview(source,f.policyStore,'reviewer',selector),
  /evidence changed/);
});
test('membership revoked between source reads never confirms a preview',async()=>{
 const f=fixture();await committed(f);
 let n=0;
 const source={async readAuthorized(input){
  const snapshot=await f.sourceStore.readAuthorized(input);
  if(++n===1)f.memberships.delete('reviewer');
  return snapshot;
 }};
 await assert.rejects(readAuthorizedProposalDraftPreview(source,f.policyStore,'reviewer',selector),
  /Unauthorized/);
});
test('mid-read activation of a new ratecard never returns an old pricing preview',async()=>{
 const f=fixture();await committed(f);
 let n=0;
 const policies={async readAuthorized(input){
  const snapshot=await f.policyStore.readAuthorized(input);
  if(++n===1)f.setHistory(approved(2));
  return snapshot;
 }};
 await assert.rejects(readAuthorizedProposalDraftPreview(f.sourceStore,policies,'reviewer',selector),
  /ratecard changed during draft/);
});
test('missing or unapproved company policy cannot produce a pricing draft',async()=>{
 const f=fixture();await committed(f);
 await assert.rejects(readAuthorizedProposalDraftPreview(f.sourceStore,
  {readAuthorized:async()=>null},'reviewer',selector),/policy is unavailable/);
 await assert.rejects(readAuthorizedProposalDraftPreview(f.sourceStore,
  {readAuthorized:async()=>({organizationId:ORG,activeRevision:null,revisions:[]})},
  'reviewer',selector),/Policy history|approved/);
});
test('same unchanged evidence and policy produce the same snapshot fingerprint',async()=>{
 const f=fixture();await committed(f);
 const first=await readDraft(f),second=await readDraft(f);
 assert.equal(first.draftSnapshotSha256,second.draftSnapshotSha256);
 assert.deepEqual(first.preview,second.preview);
});

test('original draft refuses restored legacy scope when a correction lifecycle exists',async()=>{
 for(const field of ['pendingCorrection','activatedCorrection','correctedScopeReview']){
  const f=fixture();await committed(f);
  const current=f.get();current[field]={state:'forged-current-correction'};f.put(current);
  await assert.rejects(readDraft(f),/No valid committed human service review/);
 }
});
test('original draft refuses correction state that appears between authorized source reads',async()=>{
 const f=fixture();await committed(f);
 let count=0;
 const source={readAuthorized:async input=>{
  const before=await f.sourceStore.readAuthorized(input);
  if(++count===1){
   const current=f.get();current.activatedCorrection={state:'awaiting-renewed-human-scope-review'};
   f.put(current);
  }
  return before;
 }};
 await assert.rejects(readAuthorizedProposalDraftPreview(
  source,f.policyStore,'reviewer',selector),/No valid committed human service review/);
});
test('original draft permits explicitly null lifecycle columns on uncorrected rows',async()=>{
 const f=fixture();await committed(f);
 const current=f.get();
 current.pendingCorrection=null;current.activatedCorrection=null;
 current.correctedScopeReview=null;
 f.put(current);
 const result=await readDraft(f);
 assert.equal(result.state,'preview-only');
 assert.equal(result.preview.selectedServices[0].serviceCode,'office');
});
