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

test('review selection is committed against current policy, but not proposal-approved',async()=>{
 const f=fixture(),req=await request(f);
 const result=await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 assert.equal(result.state,'reviewed-for-proposal-draft');assert.equal(result.revision,3);
 const stored=f.get();assert.equal(stored.scopeReview.reviewedBy,REVIEWER);
 assert.deepEqual(stored.scopeReview.selectedIndices,[0]);
 assert.equal(stored.scopeReview.sourceRevision,3);
 assert.equal(stored.scopeReview.policyRevision,1);
 assert.match(result.reviewedSelectionSha256,/^[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(stored.scopeReview,'quoteTotalCents'),false);
 assert.equal(Object.hasOwn(result,'send'),false);
 assert.equal(Object.hasOwn(result,'approved'),false);
});
test('optional add-on requires explicit separate acknowledgement',async()=>{
 const f=fixture(),req=await request(f,{selectedIndices:[0,1]});
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req),/acknowledgement/);
 req.acceptedAddonCodes=['carpet'];
 const committed=await commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req);
 assert.equal(committed.state,'reviewed-for-proposal-draft');
 assert.deepEqual(f.get().scopeReview.acceptedAddonCodes,['carpet']);
});
test('stale and concurrent reviewers cannot produce multiple decisions',async()=>{
 const f=fixture(),req=await request(f);
 const res=await Promise.allSettled([
   commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req),
   commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req)]);
 assert.equal(res.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(res.filter(x=>x.status==='rejected').length,1);
 assert.equal(f.get().revision,3);
 assert.equal(f.get().scopeReview.selectedIndices.length,1);
});
test('revoked, view-only and foreign reviewers fail at commit',async()=>{
 const f=fixture(),req=await request(f);
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'viewer',req),/Unauthorized/);
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'foreign',req),/Unauthorized/);
 f.hooks(()=>f.memberships.delete('reviewer'));
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req),/Unauthorized/);
 assert.equal(f.get().scopeReview,null);
});
test('tampered source or extraction suggestion invalidates old review key and snapshot',async()=>{
 for(const mutation of [x=>{x.original.text+=' changed'},
  x=>{x.review.candidates[0].units=25},x=>{x.revision++},x=>{x.review=null}]){
  const f=fixture(),req=await request(f),item=f.get();mutation(item);f.put(item);
  await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req));
  assert.equal(f.get().scopeReview,null);
 }
});
test('company ratecard change forces reload rather than stale-priced decision',async()=>{
 const f=fixture(),req=await request(f);f.setHistory(approved(2));
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req),/policy or review key changed/);
 assert.equal(f.get().scopeReview,null);
});
test('post-commit policy activation leaves stale-bound audit and denies success',async()=>{
 const f=fixture(),req=await request(f);
 f.hooks(()=>{},()=>f.setHistory(approved(2)));
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req),/policy changed during/);
 assert.equal(f.get().scopeReview.policyRevision,1);
 assert.equal(f.get().scopeReview.state,'reviewed-for-proposal-draft');
});
test('forged approvals, actor, amounts, unsupported selection fail closed',async()=>{
 const f=fixture(),req=await request(f);
 for(const extra of [{send:true},{approved:true},{actorId:AUTHOR},{quoteTotalCents:1},
  {selectedIndices:[]},{selectedIndices:[0,0]},{acceptedAddonCodes:['carpet']},
  {sourceId:'../other'},{reviewKey:'bad'},{expectedRevision:0}]){
  await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer', {...req,...extra}));
 }
 assert.equal(f.get().scopeReview,null);
});
test('false backend acknowledgement and changed audit fail read-back',async()=>{
 for(const behavior of ['fake','tampered'] ){
  const f=fixture(),req=await request(f);
  const store={readAuthorized:f.sourceStore.readAuthorized,
   async mutateAuthorized(opts){if(behavior==='fake')return opts.transform(f.get(),REVIEWER);
    const result=await f.sourceStore.mutateAuthorized(opts);
    const stored=f.get();stored.scopeReview.reviewedBy=AUTHOR;f.put(stored);
    return result;}};
  await assert.rejects(commitAuthorizedServiceReview(store,f.policyStore,'reviewer',req),/read-back|confirm/);
 }
});
test('lost access after committed decision cannot be counted successful',async()=>{
 const f=fixture(),req=await request(f);
 f.hooks(()=>{},()=>f.memberships.delete('reviewer'));
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,'reviewer',req),/Unauthorized/);
 assert.equal(f.get().revision,3);
});
test('forged or mismatched extraction audit cannot be approved',async()=>{
 for(const mutation of [x=>{x.extractionAudit[0].sourceSha256='f'.repeat(64)},
  x=>{x.extractionAudit[0].sourceRevision=1},
  x=>{x.extractionAudit[0].actorId='browser-user'}]) {
  const f=fixture(),stored=f.get();mutation(stored);f.put(stored);
  await assert.rejects(readServiceReviewContext(f.sourceStore,f.policyStore,'reviewer',selector),/absent, malformed/);
 }
});

test('legacy store-backed human review forbids noncanonical selected order',async()=>{
 const f=fixture();
 const expected=await request(f,{selectedIndices:[1,0],acceptedAddonCodes:['carpet']});
 await assert.rejects(commitAuthorizedServiceReview(
   f.sourceStore,f.policyStore,'reviewer',expected,
 ),/noncanonical/);
 assert.equal(f.get().revision,2);
 assert.equal(f.get().scopeReview,null);
 const valid=await request(f,{selectedIndices:[0,1],acceptedAddonCodes:['carpet']});
 const result=await commitAuthorizedServiceReview(
   f.sourceStore,f.policyStore,'reviewer',valid,
 );
 assert.equal(result.state,'reviewed-for-proposal-draft');
 assert.deepEqual(f.get().scopeReview.selectedIndices,[0,1]);
});
