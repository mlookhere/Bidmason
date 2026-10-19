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


import {reconcileServiceReview} from '../lib/service-review-reconciliation.ts';

test('uncommitted scope remains unchanged-at-read without writing',async()=>{
 const f=fixture(),req=await request(f);
 assert.deepEqual(await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req),
  {state:'unchanged-at-read',sourceId:SOURCE});
 assert.equal(f.counts().mutations,0);
});
test('durable exact reviewed scope is confirmed by authorized reads',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 const before=f.get(),result=await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 assert.deepEqual(result,{state:'confirmed-current-at-read',sourceId:SOURCE,revision:3,
   reviewedBy:REVIEWER,reviewedSelectionSha256:before.scopeReview.reviewedSelectionSha256});
 assert.deepEqual(f.get(),before);
 assert.equal(f.counts().mutations,1);
});
test('historical review becomes stale after a newly approved company ratecard',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 f.setHistory(approved(2));
 const result=await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 assert.equal(result.state,'recorded-stale-policy');
 assert.equal(result.revision,3);
});
test('revoked and foreign sessions cannot reconcile private scope records',async()=>{
 const f=fixture(),req=await request(f);
 await assert.rejects(reconcileServiceReview(f.sourceStore,f.policyStore,'foreign',req),/Unauthorized/);
 f.memberships.delete('reviewer');
 await assert.rejects(reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req),/Unauthorized/);
});
test('tampered evidence, extraction audit or reviewed selection fail closed',async()=>{
 for(const change of [
  x=>x.scopeReview.selectedIndices=[0,1],
  x=>x.scopeReview.acceptedAddonCodes=['carpet'],
  x=>x.scopeReview.reviewedSelectionSha256='0'.repeat(64),
  x=>x.scopeReview.quoteTotalCents=1,
  x=>x.original.text+=' altered',
  x=>x.extractionAudit[0].sourceSha256='0'.repeat(64),
 ]){
  const f=fixture(),req=await request(f);
  await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
  const record=f.get();change(record);f.put(record);
  assert.equal((await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req)).state,'conflict');
 }
});
test('forged directives and malformed identifiers rejected before record reads',async()=>{
 const f=fixture(),req=await request(f),before=f.counts().reads;
 for(const value of [
  {...req,send:true},{...req,approved:true},{...req,actorId:REVIEWER},
  {...req,sourceId:'../private'},{...req,reviewKey:'wrong'},
  {...req,expectedRevision:0},{...req,selectedIndices:[-1]},
  {...req,selectedIndices:[0,0]},{...req,acceptedAddonCodes:['carpet','carpet']},null
 ])await assert.rejects(reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',value),/Invalid/);
 assert.equal(f.counts().reads,before);
});
test('altered input selection, hash or review key cannot match stored decision',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 for(const changed of [
  {...req,selectedIndices:[1]}, {...req,acceptedAddonCodes:['carpet']},
  {...req,expectedSnapshotSha256:'0'.repeat(64)},
  {...req,reviewKey:'0'.repeat(64)}
 ]) assert.equal((await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',changed)).state,'conflict');
});
test('source change between two reads invalidates the confirmation',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 let n=0;
 const source={async readAuthorized(input){
  const first=await f.sourceStore.readAuthorized(input);
  if(++n===1){const altered=f.get();altered.revision+=1;f.put(altered);}
  return first;
 }};
 assert.equal((await reconcileServiceReview(source,f.policyStore,'reviewer',req)).state,'conflict');
});
test('active policy rotation during reads invalidates current confirmation',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 let n=0;
 const policies={async readAuthorized(input){
  const snapshot=await f.policyStore.readAuthorized(input);
  if(++n===1)f.setHistory(approved(2));
  return snapshot;
 }};
 assert.equal((await reconcileServiceReview(f.sourceStore,policies,'reviewer',req)).state,
  'recorded-stale-policy');
});
test('policy rotation cannot upgrade a conflicting record to a valid stale decision',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 const altered=f.get();altered.scopeReview.selectedIndices=[0,1];f.put(altered);
 let n=0;
 const policies={async readAuthorized(input){
  const snapshot=await f.policyStore.readAuthorized(input);
  if(++n===1)f.setHistory(approved(2));
  return snapshot;
 }};
 assert.equal((await reconcileServiceReview(f.sourceStore,policies,'reviewer',req)).state,'conflict');
});
test('policy rotation never treats original uncommitted source as confirmed',async()=>{
 const f=fixture(),req=await request(f);
 let n=0;
 const policies={async readAuthorized(input){
  const snapshot=await f.policyStore.readAuthorized(input);
  if(++n===1)f.setHistory(approved(2));
  return snapshot;
 }};
 assert.equal((await reconcileServiceReview(f.sourceStore,policies,'reviewer',req)).state,
  'unchanged-at-read');
});
test('missing sources and missing approved policy fail without guessing outcome',async()=>{
 const f=fixture(),req=await request(f);
 await assert.rejects(reconcileServiceReview({readAuthorized:async()=>null},f.policyStore,'reviewer',req),/missing/);
 await assert.rejects(reconcileServiceReview(f.sourceStore,{readAuthorized:async()=>null},'reviewer',req),/unavailable/);
});

test('legacy review reconciliation and CAS use the same lifecycle-aware fingerprint',async()=>{
 const f=fixture(),req=await request(f);
 assert.deepEqual(await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req),
  {state:'unchanged-at-read',sourceId:SOURCE});
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 const recorded=await reconcileServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 assert.equal(recorded.state,'confirmed-current-at-read');
});
test('legacy review reconciliation returns conflict for newly corrected lifecycle',async()=>{
 for(const field of ['pendingCorrection','activatedCorrection','correctedScopeReview']){
  const f=fixture(),req=await request(f);
  await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
  const record=f.get();record[field]={state:'not-legacy'};f.put(record);
  assert.equal((await reconcileServiceReview(
   f.sourceStore,f.policyStore,'reviewer',req)).state,'conflict');
 }
});
test('legacy review recovery notices correction inserted between authorized reads',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 let reads=0;
 const source={readAuthorized:async input=>{
  const record=await f.sourceStore.readAuthorized(input);
  if(++reads===1){
   const altered=f.get();altered.pendingCorrection={state:'pending-authorized-activation'};
   f.put(altered);
  }
  return record;
 }};
 assert.equal((await reconcileServiceReview(source,f.policyStore,'reviewer',req)).state,
  'conflict');
});

test('recovery rejects accessor, hidden and malformed review selectors without executing getters',async()=>{
 const f=fixture(),req=await request(f),readsBefore=f.counts().reads;
 let calls=0;
 const hidden={...req};
 Object.defineProperty(hidden,'send',{value:true});
 const symbolic={...req};
 symbolic[Symbol('approve')]=true;
 const inherited=Object.assign(Object.create({send:true}),req);
 const selectorGetter={...req};
 Object.defineProperty(selectorGetter,'sourceId',{enumerable:true,
  get(){calls++;throw Error('unsafe selector getter');}});
 const indexedGetter={...req,selectedIndices:[0]};
 Object.defineProperty(indexedGetter.selectedIndices,'0',{enumerable:true,
  get(){calls++;throw Error('unsafe index getter');}});
 const addonGetter={...req,acceptedAddonCodes:['carpet']};
 Object.defineProperty(addonGetter.acceptedAddonCodes,'0',{enumerable:true,
  get(){calls++;throw Error('unsafe add-on getter');}});
 const sparse={...req,selectedIndices:new Array(1)};
 const decorated={...req,selectedIndices:[0]};
 Object.defineProperty(decorated.selectedIndices,'send',{value:true});
 const altered={...req,acceptedAddonCodes:[]};
 Object.setPrototypeOf(altered.acceptedAddonCodes,Object.create(Array.prototype));
 for(const bad of [hidden,symbolic,inherited,selectorGetter,indexedGetter,
  addonGetter,sparse,decorated,altered]){
  await assert.rejects(reconcileServiceReview(f.sourceStore,f.policyStore,
   'reviewer',bad),/Invalid scope reconciliation request/);
 }
 assert.equal(calls,0);
 assert.equal(f.counts().reads,readsBefore);
});

test('recovery freezes request identifiers, proof and selections before async authorized reads',async()=>{
 const f=fixture(),req=await request(f);
 await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 const recorded=f.get();
 let readCount=0;
 const store={async readAuthorized(input){
  readCount++;
  assert.equal(input.organizationId,ORG);
  assert.equal(input.sourceId,SOURCE);
  const result=await f.sourceStore.readAuthorized(input);
  if(readCount===1){
   req.organizationId=OTHER;
   req.sourceId=OTHER;
   req.expectedRevision=999;
   req.expectedSnapshotSha256='0'.repeat(64);
   req.reviewKey='1'.repeat(64);
   req.selectedIndices[0]=1;
   req.acceptedAddonCodes.push('carpet');
  }
  return result;
 }};
 const outcome=await reconcileServiceReview(store,f.policyStore,'reviewer',req);
 assert.deepEqual(outcome,{state:'confirmed-current-at-read',
  sourceId:SOURCE,revision:3,reviewedBy:REVIEWER,
  reviewedSelectionSha256:recorded.scopeReview.reviewedSelectionSha256});
 assert.equal(readCount,2);
 assert.deepEqual(f.get(),recorded);
});
