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

test('original-extraction review rejects all correction lifecycle states before preview',async()=>{
 for(const key of ['pendingCorrection','activatedCorrection','correctedScopeReview']){
  const f=fixture();
  const row=f.get();
  row[key]={state:'injected-correction'};
  f.put(row);
  await assert.rejects(readServiceReviewContext(f.sourceStore,f.policyStore,
   'reviewer',selector),/Stored extraction is absent/);
  assert.equal(f.counts().mutations,0);
 }
});
test('legacy review refuses correction appearing after context and before locked commit',async()=>{
 const f=fixture(),req=await request(f);
 const row=f.get();row.pendingCorrection={state:'pending-authorized-activation'};
 f.put(row);
 await assert.rejects(commitAuthorizedServiceReview(f.sourceStore,f.policyStore,
  'reviewer',req),/Stored extraction is absent/);
 assert.equal(f.get().scopeReview,null);
});
test('legacy review rejects inherited and getter-backed correction state without executing it',async()=>{
 const {hasCorrectionLifecycle}=await import('../lib/tenant-service-review.ts');
 let called=0;
 const getter={scopeReview:null};
 Object.defineProperty(getter,'activatedCorrection',{enumerable:true,
  get(){called++;return {state:'forged'};}});
 assert.equal(hasCorrectionLifecycle(getter),true);
 assert.equal(called,0);
 const inherited=Object.create({pendingCorrection:{state:'pending'}});
 assert.equal(hasCorrectionLifecycle(inherited),true);
 assert.equal(hasCorrectionLifecycle({pendingCorrection:null,activatedCorrection:null,
  correctedScopeReview:null}),false);
});
test('review selectors reject hidden and accessor directives without authorizing source reads',async()=>{
 const f=fixture(),hidden={...selector},getter={...selector},foreign={...selector};
 let called=0;
 Object.defineProperty(hidden,'send',{value:true});
 Object.defineProperty(getter,'organizationId',{enumerable:true,
  get(){called++;return ORG;}});
 Object.setPrototypeOf(foreign,{send:true});
 for(const bad of [hidden,getter,foreign]){
  await assert.rejects(readServiceReviewContext(f.sourceStore,f.policyStore,
   'reviewer',bad),/Invalid reviewed intake source selector/);
 }
 assert.equal(called,0);
 assert.equal(f.counts().reads,0);
});

test('human scope commit denies forged hidden/symbol/accessor fields and array getters',async()=>{
 const f=fixture(),req=await request(f);
 let getterCalls=0;
 const hidden={...req};
 Object.defineProperty(hidden,'send',{value:true});
 const symbolic={...req};
 symbolic[Symbol('approved')]=true;
 const accessor={...req};
 Object.defineProperty(accessor,'sourceId',{enumerable:true,
  get(){getterCalls++;return SOURCE;}});
 const inherited=Object.assign(Object.create({send:true}),req);
 const arrayGetter={...req,selectedIndices:[0]};
 Object.defineProperty(arrayGetter.selectedIndices,'0',{configurable:true,enumerable:true,
  get(){getterCalls++;return 0;}});
 const addonGetter={...req,acceptedAddonCodes:['carpet']};
 Object.defineProperty(addonGetter.acceptedAddonCodes,'0',{configurable:true,enumerable:true,
  get(){getterCalls++;return 'carpet';}});
 const extraArray={...req,selectedIndices:[0]};
 Object.defineProperty(extraArray.selectedIndices,'send',{value:true});
 const sparse={...req,selectedIndices:new Array(1)};
 for(const bad of [hidden,symbolic,accessor,inherited,arrayGetter,addonGetter,extraArray,sparse]){
  await assert.rejects(commitAuthorizedServiceReview(
   f.sourceStore,f.policyStore,'reviewer',bad),/Invalid reviewed scope commit request/);
 }
 assert.equal(getterCalls,0);
 assert.equal(f.counts().mutations,0);
 assert.equal(f.get().scopeReview,null);
});

test('scope review snapshots tenant, source, receipts and selections before async policy read',async()=>{
 const f=fixture(),req=await request(f);
 let observed=0;
 f.hooks(()=>{},()=>{},()=>{
  observed++;
  req.organizationId=OTHER;
  req.sourceId=OTHER;
  req.expectedRevision=999;
  req.expectedSnapshotSha256='0'.repeat(64);
  req.reviewKey='1'.repeat(64);
  req.selectedIndices[0]=1;
  req.acceptedAddonCodes.push('carpet');
 });
 const confirmed=await commitAuthorizedServiceReview(
  f.sourceStore,f.policyStore,'reviewer',req);
 assert.equal(confirmed.sourceId,SOURCE);
 assert.equal(confirmed.revision,3);
 assert.deepEqual(f.get().scopeReview.selectedIndices,[0]);
 assert.deepEqual(f.get().scopeReview.acceptedAddonCodes,[]);
 assert.ok(observed>=2);
});

test('context review snapshots selector before any async source read',async()=>{
 const f=fixture(),mutable={...selector};
 const original=f.sourceStore.readAuthorized.bind(f.sourceStore);
 let switched=false;
 const store={
  readAuthorized(input){
   if(!switched){
    switched=true;
    mutable.organizationId=OTHER;
    mutable.sourceId=OTHER;
   }
   return original(input);
  },mutateAuthorized:f.sourceStore.mutateAuthorized,
 };
 const ctx=await readServiceReviewContext(store,f.policyStore,'reviewer',mutable);
 assert.equal(ctx.organizationId,ORG);
 assert.equal(ctx.sourceId,SOURCE);
 assert.equal(ctx.expectedRevision,2);
});


test('stored service review context rejects hostile root, audit and extraction evidence before policy lookup',async()=>{
 const f=fixture();
 let getters=0,sourceReads=0,policyReads=0;
 const bad=[
  row=>Object.defineProperty(row,'organizationId',{enumerable:true,
   get(){getters++;throw Error('unsafe organization');}}),
  row=>Object.defineProperty(row,'revision',{enumerable:true,
   get(){getters++;throw Error('unsafe revision');}}),
  row=>Object.defineProperty(row,'original',{enumerable:true,
   get(){getters++;throw Error('unsafe original');}}),
  row=>Object.defineProperty(row.original,'text',{enumerable:true,
   get(){getters++;throw Error('unsafe original text');}}),
  row=>Object.defineProperty(row,'review',{enumerable:true,
   get(){getters++;throw Error('unsafe review');}}),
  row=>Object.defineProperty(row.review,'candidates',{enumerable:true,
   get(){getters++;throw Error('unsafe candidates');}}),
  row=>Object.defineProperty(row.review.candidates,'0',{enumerable:true,
   get(){getters++;throw Error('unsafe candidate index');}}),
  row=>Object.defineProperty(row.review.candidates[0],'units',{enumerable:true,
   get(){getters++;throw Error('unsafe quantity');}}),
  row=>{delete row.review.candidates[0];},
  row=>{row.review.candidates[Symbol('approved')]=true;},
  row=>{row.review.candidatesSha256='0'.repeat(64);},
  row=>Object.defineProperty(row,'extractionAudit',{enumerable:true,
   get(){getters++;throw Error('unsafe audit array');}}),
  row=>Object.defineProperty(row.extractionAudit,'0',{enumerable:true,
   get(){getters++;throw Error('unsafe audit index');}}),
  row=>{delete row.extractionAudit[0];},
  row=>{row.extractionAudit[Symbol('send')]=true;},
  row=>Object.defineProperty(row.extractionAudit[0],'actorId',{enumerable:true,
   get(){getters++;throw Error('unsafe extracted-by actor');}}),
  row=>Object.defineProperty(row.extractionAudit[0],'send',{value:true}),
  row=>{row.extractionAudit[0][Symbol('approved')]=true;},
  row=>Object.setPrototypeOf(row.extractionAudit[0],{actorId:AUTHOR}),
  row=>Object.defineProperty(row,'scopeReview',{enumerable:true,
   get(){getters++;throw Error('unsafe scope review');}}),
 ];
 const policies={readAuthorized:async()=>{policyReads++;throw Error('must not read policy');}};
 for(const mutate of bad){
  const row=f.get();mutate(row);
  const stored={readAuthorized:async()=>{sourceReads++;return row;}};
  await assert.rejects(readServiceReviewContext(stored,policies,'reviewer',selector),
   /Stored extraction is absent, malformed or already reviewed/);
 }
 assert.equal(sourceReads,bad.length);
 assert.equal(policyReads,0);
 assert.equal(getters,0);
});

test('stored service review rejects altered provenance before an atomic scope write',async()=>{
 const f=fixture(),req=await request(f);
 const corrupted=f.get();
 corrupted.review.candidates[0].units=20;
 const stored={
  readAuthorized:async()=>corrupted,
  mutateAuthorized:async opts=>opts.transform(corrupted,REVIEWER),
 };
 await assert.rejects(commitAuthorizedServiceReview(stored,f.policyStore,'reviewer',req),
  /Stored extraction is absent, malformed or already reviewed/);
 assert.equal(corrupted.scopeReview,null);
 assert.equal(corrupted.revision,2);
});
