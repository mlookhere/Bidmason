import test from "node:test";
import assert from "node:assert/strict";
import { readExtractionPreparation, commitAuthorizedExtraction }
  from "../lib/tenant-extraction-service.ts";
import { readTenantIntakeWorkbench, previewTenantIntakeSelection }
  from "../lib/tenant-intake-service.ts";
import { submitPolicyDraft, reviewPolicyDraft } from "../lib/company-policy-revisions.ts";
import { emptyReviewSelection, changeReviewSelection, prepareReviewPreviewRequest }
  from "../lib/intake-review-selection.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE="11111111-1111-4111-8111-111111111111";
const ACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REVIEWER="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORIGINAL={kind:"typed-note",text:"Clean 2 rooms; include supplies"};
const candidates=[{serviceCode:"rooms",units:2,start:0,end:13,excerpt:"Clean 2 rooms"}];
const raw=JSON.stringify({candidates});

function fixture() {
  let row={organizationId:ORG,sourceId:SOURCE,revision:1,
    original:structuredClone(ORIGINAL),review:null,extractionAudit:[]};
  const grants=new Map([
    ["operator",{org:ORG,actor:ACTOR,roles:["read","extract"]}],
    ["viewer",{org:ORG,actor:REVIEWER,roles:["read"]}],
    ["foreign",{org:FOREIGN,actor:REVIEWER,roles:["read","extract"]}],
  ]);
  let reads=0,writes=0,queue=Promise.resolve(),beforeWrite=()=>{};
  const allow=(session,organizationId,permission)=>{
    const g=grants.get(session);
    if (!g || g.org!==organizationId || !g.roles.includes(permission)) {
      throw new Error("Unauthorized tenant extraction");
    }
    return g.actor;
  };
  const store={
    async readAuthorized({organizationId,sourceId,session}){
      ++reads;allow(session,organizationId,"read");
      return sourceId===SOURCE?structuredClone(row):null;
    },
    mutateAuthorized({organizationId,sourceId,session,permission,transform}){
      const work=queue.catch(()=>{}).then(()=>{
        ++writes;beforeWrite();
        const actor=allow(session,organizationId,permission);
        const next=transform(sourceId===SOURCE?structuredClone(row):null,actor);
        row=structuredClone(next);return structuredClone(next);
      });
      queue=work.then(()=>{},()=>{});
      return work;
    }
  };
  return {store,grants,read:()=>structuredClone(row),set:x=>row=structuredClone(x),
    hook:fn=>beforeWrite=fn,counts:()=>({reads,writes})};
}
const selector={organizationId:ORG,sourceId:SOURCE};
async function request(f){
 const p=await readExtractionPreparation(f.store,"operator",selector);
 return {...selector,expectedRevision:p.expectedRevision,
   expectedSnapshotSha256:p.expectedSnapshotSha256,rawExtractionResponse:raw};
}
test("authenticated extraction writes only a provenance-linked review and actor audit",async()=>{
 const f=fixture(),r=await request(f);
 const result=await commitAuthorizedExtraction(f.store,"operator",r);
 assert.equal(result.state,"needs-human-review");
 assert.equal(result.revision,2);
 assert.equal(result.sourceId,SOURCE);
 const row=f.read();
 assert.deepEqual(row.original,ORIGINAL);
 assert.equal(row.review.state,"needs-human-review");
 assert.equal(row.review.candidates[0].excerpt,"Clean 2 rooms");
 assert.equal(row.extractionAudit[0].actorId,ACTOR);
 assert.equal(row.extractionAudit[0].sourceRevision,2);
 assert.equal(row.extractionAudit[0].candidatesSha256,row.review.candidatesSha256);
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
 assert.equal(f.counts().reads,2);
});
test("duplicate concurrent commits to one revision yield one success only",async()=>{
 const f=fixture(),r=await request(f);
 const outcomes=await Promise.allSettled([
   commitAuthorizedExtraction(f.store,"operator",r),
   commitAuthorizedExtraction(f.store,"operator",r)]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
 assert.equal(f.read().extractionAudit.length,1);
});
test("source changes invalidate snapshot even without revision increment",async()=>{
 for(const mutate of [
   row=>{row.original.text+=" extra"},
   row=>{row.revision=2},
   row=>{row.original.kind="transcript";row.original.transcriptionSucceeded=true},
 ]){
   const f=fixture(),r=await request(f),row=f.read();mutate(row);f.set(row);
   await assert.rejects(commitAuthorizedExtraction(f.store,"operator",r),/Stale/);
   assert.equal(f.read().review,null);
 }
});
test("cross-tenant, revoked and viewer-only sessions cannot create extraction review",async()=>{
 const f=fixture(),r=await request(f);
 await assert.rejects(readExtractionPreparation(f.store,"foreign",selector),/Unauthorized/);
 await assert.rejects(commitAuthorizedExtraction(f.store,"foreign",r),/Unauthorized/);
 await assert.rejects(commitAuthorizedExtraction(f.store,"viewer",r),/Unauthorized/);
 f.hook(()=>f.grants.delete("operator"));
 await assert.rejects(commitAuthorizedExtraction(f.store,"operator",r),/Unauthorized/);
 assert.equal(f.read().review,null);
});
test("unapproved transcript cannot prepare extraction regardless of offered model output",async()=>{
 const f=fixture(),row=f.read();
 row.original={kind:"transcript",text:"Clean 2 rooms",transcriptionSucceeded:false};f.set(row);
 await assert.rejects(readExtractionPreparation(f.store,"operator",selector),/source missing or invalid/);
 const other=fixture(),req=await request(other);
 const bad=other.read();bad.original={kind:"transcript",text:"Clean 2 rooms",transcriptionSucceeded:false};
 other.set(bad);
 await assert.rejects(commitAuthorizedExtraction(other.store,"operator",req),/source missing or invalid/);
});
test("model-supplied price, directives, and fabricated offsets fail inside locked transaction",async()=>{
 for(const output of [
  JSON.stringify({candidates,send:true}),JSON.stringify({candidates,approved:true}),
  JSON.stringify({candidates:[{...candidates[0],rateCents:1}]}),
  JSON.stringify({candidates:[{...candidates[0],units:900}]}).replace("Clean 2 rooms","tampered"),
 ]){
   const f=fixture(),req=await request(f);
   req.rawExtractionResponse=output;
   await assert.rejects(commitAuthorizedExtraction(f.store,"operator",req));
   assert.equal(f.read().review,null);
 }
});
test("unknown request fields and invalid identifiers are denied before write",async()=>{
 const f=fixture(),req=await request(f);
 for(const p of [{...req,approved:true},{...req,actorId:ACTOR},
  {...req,sourceId:"../other"},{...req,organizationId:"wrong"},
  {...req,expectedRevision:0},{...req,expectedSnapshotSha256:"bad"},
  {...req,rawExtractionResponse:"x".repeat(32769)}]){
   await assert.rejects(commitAuthorizedExtraction(f.store,"operator",p));
 }
 assert.equal(f.counts().writes,0);
});
test("false success, forged returned audit and post-write mutation never confirm",async()=>{
 for(const behavior of ["no-write","forged-audit","post-write-edit"]){
  const f=fixture(),req=await request(f);
  const store={readAuthorized:f.store.readAuthorized,
   async mutateAuthorized(args){
     if(behavior==="no-write"){
       const next=args.transform(f.read(),ACTOR);return structuredClone(next);
     }
     if(behavior==="forged-audit"){
       const next=await f.store.mutateAuthorized(args);
       return {...next,extractionAudit:[{...next.extractionAudit[0],actorId:REVIEWER}]};
     }
     const next=await f.store.mutateAuthorized(args);
     const row=f.read();row.review.candidates[0].units=9;f.set(row);return next;
   }};
  await assert.rejects(commitAuthorizedExtraction(store,"operator",req),
    /not confirmed|did not confirm/);
 }
});
test("revocation after durable write makes result indeterminate, not safe to retry",async()=>{
 const f=fixture(),req=await request(f);
 const store={readAuthorized:f.store.readAuthorized,
  async mutateAuthorized(args){const out=await f.store.mutateAuthorized(args);
   f.grants.delete("operator");return out;}};
 await assert.rejects(commitAuthorizedExtraction(store,"operator",req),/Unauthorized/);
 assert.equal(f.read().revision,2);
 assert.equal(f.read().extractionAudit.length,1);
});
test("persisted source can feed approved-only company review and preview without send",async()=>{
 const f=fixture();await commitAuthorizedExtraction(f.store,"operator",await request(f));
 const pricing={revision:1,pricing:{policyId:"synthetic-cleaning",currency:"USD",
  minimum:{rule:"quote",cents:12000},calculationOrder:"discount-then-surcharge",
  services:{rooms:{label:"Room cleaning",unit:"room",rateCents:3500,billing:"charged"}}},
  tax:{method:"none",bps:0}};
 const draft=submitPolicyDraft(null,{organizationId:ORG,submittedBy:ACTOR,
  policy:pricing,expectedRevision:0,expectedSha256:null});
 const approved=reviewPolicyDraft(draft,{organizationId:ORG,reviewedBy:REVIEWER,
  decision:"approve",expectedRevision:1,
  expectedSha256:draft.revisions[0].policySha256});
 const policyStore={async readAuthorized({organizationId,session}){
  if(organizationId!==ORG||!f.grants.has(session))throw Error("Unauthorized policy");
  return structuredClone(approved);
 }};
 const model=await readTenantIntakeWorkbench(f.store,policyStore,"viewer",selector);
 assert.equal(model.rows[0].status,"available");
 let selected=changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"select",index:0,checked:true});
 const preview=await previewTenantIntakeSelection(f.store,policyStore,"viewer",{
  ...selector,request:prepareReviewPreviewRequest(model,selected)});
 assert.equal(preview.state,"preview-only");
 assert.equal(preview.economics.quote.totalCents,12000);
 assert.equal(Object.hasOwn(preview,"send"),false);
});


test("missing or inconsistent review and extraction audit cannot enter an extraction transaction", async()=>{
 for(const mutate of [
   row=>{delete row.review},
   row=>{row.review={state:"needs-human-review"}},
   row=>{row.extractionAudit=[{sourceRevision:2,actorId:ACTOR,sourceSha256:"x",candidatesSha256:"y"}]},
   row=>{row.scopeReview={state:"reviewed-for-proposal-draft"}},
   row=>{row.original={...row.original,approved:true}},
   row=>{row.original={...row.original,rateCents:1}},
   row=>{row.original={...row.original,text:row.original.text+"\u0000"}},
   row=>{row.original={...row.original,text:row.original.text+"\uD800"}},
 ]){
  const f=fixture(),record=f.read();mutate(record);f.set(record);
  await assert.rejects(readExtractionPreparation(f.store,"operator",selector),
    /source missing or invalid/);
  assert.equal(f.counts().writes,0);
 }
});
test("unbound source approval or sender directives are denied at locked extraction commit",async()=>{
 for(const mutate of [
  row=>{row.original.send=true},
  row=>{row.original.approved=true},
  row=>{row.original.rateCents=1},
  row=>{row.scopeReview={approved:true}},
 ]){
  const f=fixture(),req=await request(f),row=f.read();mutate(row);f.set(row);
  await assert.rejects(commitAuthorizedExtraction(f.store,"operator",req),/source missing or invalid/);
  assert.equal(f.read().review,null);
 }
});
test("creation audit changes invalidate extraction CAS even with unchanged revision",async()=>{
 const f=fixture(),initial=f.read();
 initial.creationAudit={actorId:ACTOR,requestId:SOURCE,textSha256:"a".repeat(64)};
 f.set(initial);
 const req=await request(f),changed=f.read();
 changed.creationAudit.textSha256="b".repeat(64);
 f.set(changed);
 await assert.rejects(commitAuthorizedExtraction(f.store,"operator",req),/Stale/);
 assert.equal(f.read().extractionAudit.length,0);
});
test("malformed stored candidates or disjoint audit fingerprints cannot be read as valid",async()=>{
 const f=fixture();await commitAuthorizedExtraction(f.store,"operator",await request(f));
 for(const mutate of [
  row=>{row.review.candidates[0].rateCents=1},
  row=>{row.review.candidates[0].approved=true},
  row=>{row.review.candidates[0].excerpt="fake excerpt"},
  row=>{row.extractionAudit[0].sourceSha256="0".repeat(64)},
  row=>{row.extractionAudit[0].sourceRevision=99},
  row=>{row.extractionAudit[0].actorId="forged"},
 ]){
  const snapshot=f.read(),changed=structuredClone(snapshot);mutate(changed);f.set(changed);
  await assert.rejects(readExtractionPreparation(f.store,"operator",selector),
    /source missing or invalid/);
  f.set(snapshot);
 }
});


test("extraction commit binds full operator decision before asynchronous CAS",async()=>{
 const f=fixture(),req=await request(f);
 const expected={...req};
 f.hook(()=>{
  req.organizationId=FOREIGN;
  req.sourceId="22222222-2222-4222-8222-222222222222";
  req.expectedRevision=999;
  req.expectedSnapshotSha256="0".repeat(64);
  req.rawExtractionResponse=JSON.stringify({candidates:[{...candidates[0],units:99}]});
 });
 const result=await commitAuthorizedExtraction(f.store,"operator",req);
 assert.equal(result.state,"needs-human-review");
 assert.equal(result.sourceId,SOURCE);
 assert.equal(result.revision,2);
 assert.equal(f.read().review.candidates[0].units,2);
 assert.equal(f.read().review.sourceSha256,
  (await import("../lib/intake-review.ts")).prepareExtractionReview(
   ORIGINAL,candidates).sourceSha256);
 assert.equal(f.counts().writes,1);
 assert.equal(expected.organizationId,ORG);
});

test("preparation never retargets the authorized tenant after first read",async()=>{
 const f=fixture(),mutable={...selector};
 let called=0;
 const store={readAuthorized:async input=>{
  const record=await f.store.readAuthorized(input);
  if(++called===1){
   mutable.organizationId=FOREIGN;
   mutable.sourceId="22222222-2222-4222-8222-222222222222";
  }
  return record;
 }};
 const preview=await readExtractionPreparation(store,"operator",mutable);
 assert.equal(called,1);
 assert.equal(preview.organizationId,ORG);
 assert.equal(preview.sourceId,SOURCE);
 assert.equal(preview.expectedRevision,1);
});

test("malicious extraction selectors and hidden requests fail before authorized reads",async()=>{
 const f=fixture(),req=await request(f),before=f.counts();
 let getters=0;
 const extras={...req};
 Object.defineProperty(extras,"send",{value:true});
 const symbol={...req};symbol[Symbol("approved")]=true;
 const inherited=Object.assign(Object.create({send:true}),req);
 const accessor={...req};Object.defineProperty(accessor,"rawExtractionResponse",{
  enumerable:true,get(){getters++;throw Error("unsafe extraction getter");}
 });
 const getterId={...selector};Object.defineProperty(getterId,"organizationId",{
  enumerable:true,get(){getters++;throw Error("unsafe tenant getter");}
 });
 const hiddenSelector={...selector};
 Object.defineProperty(hiddenSelector,"customerSend",{value:true});
 const symbolicSelector={...selector};
 symbolicSelector[Symbol("send")]=true;
 for(const invalid of [extras,symbol,inherited,accessor]){
  await assert.rejects(commitAuthorizedExtraction(f.store,"operator",invalid),
   /Invalid tenant extraction selector/);
 }
 for(const invalid of [getterId,hiddenSelector,symbolicSelector]){
  await assert.rejects(readExtractionPreparation(f.store,"operator",invalid),
   /Invalid tenant extraction selector/);
 }
 assert.equal(getters,0);
 assert.deepEqual(f.counts(),before);
});


test("stored extraction evidence rejects accessor indexes and audit fields before evaluation",async()=>{
 const f=fixture();
 await commitAuthorizedExtraction(f.store,"operator",await request(f));
 const committed=f.read();
 let getters=0,reads=0;
 const invalid=[
  row=>Object.defineProperty(row.review.candidates,"0",{enumerable:true,
    get(){getters++;throw Error("unsafe candidate index getter");}}),
  row=>Object.defineProperty(row.review.candidates[0],"units",{enumerable:true,
    get(){getters++;throw Error("unsafe candidate units getter");}}),
  row=>{delete row.review.candidates[0];},
  row=>{row.review.candidates[Symbol("approved")]=true;},
  row=>Object.defineProperty(row.extractionAudit,"0",{enumerable:true,
    get(){getters++;throw Error("unsafe audit index getter");}}),
  row=>{delete row.extractionAudit[0];},
  row=>{row.extractionAudit[Symbol("send")]=true;},
  row=>Object.defineProperty(row.extractionAudit[0],"actorId",{enumerable:true,
    get(){getters++;throw Error("unsafe audit actor getter");}}),
  row=>Object.defineProperty(row.extractionAudit[0],"approved",{value:true}),
  row=>{row.extractionAudit[0][Symbol("send")]=true;},
  row=>Object.setPrototypeOf(row.extractionAudit[0],{actorId:ACTOR}),
 ];
 for(const mutate of invalid){
  const record=structuredClone(committed);mutate(record);
  const store={readAuthorized:async()=>{
    reads++;return record;
  }};
  await assert.rejects(readExtractionPreparation(store,"operator",selector),
   /Tenant-owned extraction source missing or invalid/);
 }
 assert.equal(reads,invalid.length);
 assert.equal(getters,0);
});

test("a canonical persisted extraction audit remains recognized but not re-extractable",async()=>{
 const f=fixture();
 await commitAuthorizedExtraction(f.store,"operator",await request(f));
 const canonical=f.read();
 const store={readAuthorized:async()=>structuredClone(canonical)};
 await assert.rejects(readExtractionPreparation(store,"operator",selector),
  /already been committed/);
 assert.equal(canonical.extractionAudit[0].actorId,ACTOR);
 assert.equal(canonical.review.candidates[0].units,2);
});
