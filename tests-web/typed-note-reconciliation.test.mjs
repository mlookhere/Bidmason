import {reconcileAuthorizedTypedNote} from "../lib/typed-note-reconciliation.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commitAuthorizedTypedNote } from "../lib/tenant-typed-note-source.ts";
import { readExtractionPreparation } from "../lib/tenant-extraction-service.ts";
import { prepareExtractionReview } from "../lib/intake-review.ts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUEST = "11111111-1111-4111-8111-111111111111";
const note = { organizationId: ORG, requestId: REQUEST, text: "Paint 2 rooms\nInclude primer." };

function fixture() {
  const records = new Map(), ledger = new Map();
  let count = 0, reads = 0, beforeCreate = () => {}, afterCreate = () => {};
  const members = new Map([
    ["operator", {org: ORG, actor: ACTOR, create: true}],
    ["reader", {org: ORG, actor: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", create: false}],
    ["foreign", {org: OTHER, actor: ACTOR, create: true}],
  ]);
  function authorize(session, org, write = false) {
    const m = members.get(session);
    if (!m || m.org !== org || (write && !m.create)) throw new Error("Unauthorized source");
    return m.actor;
  }
  let queue = Promise.resolve();
  const store = {
    createAuthorized({session, organizationId, requestId, permission,
      textSha256, materialize}) {
      const work = queue.catch(() => {}).then(() => {
        beforeCreate();
        if (permission !== "create-intake") throw new Error("Unauthorized permission");
        const actor = authorize(session, organizationId, true);
        const key = [organizationId, actor, requestId].join(":");
        let row;
        if (ledger.has(key)) {
          const existing = ledger.get(key);
          if (existing.sha !== textSha256) throw new Error("Idempotency key payload conflict");
          row = records.get(existing.sourceId);
        } else {
          const sourceId = randomUUID();
          row = materialize({sourceId, authenticatedActorId: actor});
          records.set(sourceId, structuredClone(row));
          ledger.set(key, {sourceId, sha: textSha256});
          count++;
        }
        afterCreate();
        return {record: structuredClone(row), authenticatedActorId: actor};
      });
      queue = work.then(() => {}, () => {});
      return work;
    },
    async readAuthorized({session, organizationId, sourceId}) {
      reads++;
      authorize(session, organizationId);
      const row = records.get(sourceId);
      return row?.organizationId === organizationId ? structuredClone(row) : null;
    },
  };
  return {store, members, records, ledger, calls: () => ({count,reads}),
    hooks: (a = () => {}, b = () => {}) => {beforeCreate = a; afterCreate = b;}};
}


function advanceToExtraction(f, id) {
  const row = f.records.get(id);
  const review = prepareExtractionReview(row.original, [{serviceCode:"painting",
    units:2,start:0,end:13,excerpt:"Paint 2 rooms"}]);
  row.revision = 2;
  row.review = review;
  row.extractionAudit = [{sourceRevision:2,actorId:ACTOR,
    sourceSha256:review.sourceSha256,candidatesSha256:review.candidatesSha256}];
  return row;
}
function advanceToScope(f,id) {
  const row = advanceToExtraction(f,id);
  row.revision = 3;
  row.scopeReview = {sourceRevision:3,reviewedBy:ACTOR,
    reviewKey:"a".repeat(64),sourceSha256:row.review.sourceSha256,
    candidatesSha256:row.review.candidatesSha256,selectedIndices:[0],
    acceptedAddonCodes:[],policyRevision:1,policySha256:"b".repeat(64),
    reviewedSelectionSha256:"c".repeat(64),state:"reviewed-for-proposal-draft"};
  return row;
}

function trustedLedger(f,{afterRead=()=>{}}={}){
 let calls=0;
 return {count:()=>calls,async lookupAuthorized(input){
   assert.equal(input.permission,"create-intake");
   const member=f.members.get(input.session);
   if(!member || member.org!==input.organizationId || !member.create)
     throw Error("Unauthorized idempotency ledger");
   const entry=f.ledger.get([input.organizationId,member.actor,input.requestId].join(":"));
   const row=entry?f.records.get(entry.sourceId):null;
   const receipt=entry?{authenticatedActorId:member.actor,
     textSha256:entry.sha,record:row?structuredClone(row):null}:null;
   calls++;
   await afterRead(calls,f);
   return receipt;
 }};
}
test("read-only reconciliation confirms original unprocessed note",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 const adapter=trustedLedger(f);
 assert.deepEqual(await reconcileAuthorizedTypedNote(adapter,"operator",note),
  {state:"confirmed-unprocessed",organizationId:ORG,sourceId:created.sourceId,
   revision:1,textSha256:created.textSha256});
 assert.equal(adapter.count(),2);assert.equal(f.calls().count,1);
});
test("reconciliation confirms the same source after extraction with no new write",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 advanceToExtraction(f,created.sourceId);
 const value=await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",note);
 assert.deepEqual(value,{state:"confirmed-advanced",organizationId:ORG,
  sourceId:created.sourceId,revision:2,textSha256:created.textSha256});
 assert.equal(f.calls().count,1);
});
test("reconciliation confirms original identity after human reviewed scope",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 advanceToScope(f,created.sourceId);
 const result=await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",note);
 assert.equal(result.state,"confirmed-advanced");assert.equal(result.revision,3);
 assert.equal(result.sourceId,created.sourceId);
 assert.equal(Object.hasOwn(result,"approved"),false);
 assert.equal(Object.hasOwn(result,"send"),false);
});
test("two authorized absent reads do not claim rollback or enable creation",async()=>{
 const f=fixture();const adapter=trustedLedger(f);
 const result=await reconcileAuthorizedTypedNote(adapter,"operator",note);
 assert.deepEqual(result,{state:"not-found-at-read",organizationId:ORG,requestId:REQUEST});
 assert.equal(adapter.count(),2);assert.equal(f.calls().count,0);
});
test("late original commit between two reads is reported as changing, not absent",async()=>{
 const f=fixture();const adapter=trustedLedger(f,{
  async afterRead(count){if(count===1)await commitAuthorizedTypedNote(f.store,"operator",note);}
 });
 const result=await reconcileAuthorizedTypedNote(adapter,"operator",note);
 assert.equal(result.state,"changed-during-read");assert.equal(f.calls().count,1);
});
test("source progression between two reads is not called confirmed",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 const adapter=trustedLedger(f,{afterRead(count){
  if(count===1)advanceToExtraction(f,created.sourceId);
 }});
 const result=await reconcileAuthorizedTypedNote(adapter,"operator",note);
 assert.equal(result.state,"changed-during-read");
});
test("payload conflict under a reused request id never confirms original",async()=>{
 const f=fixture();await commitAuthorizedTypedNote(f.store,"operator",note);
 const result=await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",
  {...note,text:"Paint 200 rooms"});
 assert.equal(result.state,"conflict");assert.equal(f.calls().count,1);
});
test("missing ledger-linked source is conflict, not absence",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 f.records.delete(created.sourceId);
 assert.equal((await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",note)).state,
  "conflict");
});
test("corrupted original, creation audit and progressed evidence are conflict",async()=>{
 for(const mutate of [
  row=>row.original.text="tamper",row=>row.creationAudit.actorId=randomUUID(),
  row=>row.creationAudit.requestId=randomUUID(),row=>row.revision=4,
  row=>row.review.candidates[0].excerpt="fabricated",
  row=>row.extractionAudit[0].actorId="spoof",
  row=>row.scopeReview.send=true,
 ]){
  const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
  const row=advanceToScope(f,created.sourceId);mutate(row);
  assert.equal((await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",note)).state,
   "conflict");
  assert.equal(f.calls().count,1);
 }
});
test("forged ledger digest or actor is not accepted as proof",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 for(const mutation of [
  row=>row.textSha256="a".repeat(64),
  row=>row.authenticatedActorId=randomUUID(),
  row=>row.approved=true,
 ]){
  const adapter=trustedLedger(f);
  const wrapped={async lookupAuthorized(input){const result=await adapter.lookupAuthorized(input);
   mutation(result);return result;}};
  assert.equal((await reconcileAuthorizedTypedNote(wrapped,"operator",note)).state,
   "conflict");
 }
 assert.equal(f.records.has(created.sourceId),true);
});
test("revoked membership and cross-tenant actor cannot inspect ledger",async()=>{
 const f=fixture();await commitAuthorizedTypedNote(f.store,"operator",note);
 const adapter=trustedLedger(f);
 await assert.rejects(reconcileAuthorizedTypedNote(adapter,"foreign",note),/Unauthorized/);
 await assert.rejects(reconcileAuthorizedTypedNote(adapter,"reader",note),/Unauthorized/);
 f.members.delete("operator");
 await assert.rejects(reconcileAuthorizedTypedNote(adapter,"operator",note),/Unauthorized/);
});
test("access revoked between primary ledger reads propagates an error",async()=>{
 const f=fixture();await commitAuthorizedTypedNote(f.store,"operator",note);
 const adapter=trustedLedger(f,{afterRead(n){if(n===1)f.members.delete("operator");}});
 await assert.rejects(reconcileAuthorizedTypedNote(adapter,"operator",note),/Unauthorized/);
});
test("lookup storage failure is not silently converted into absence",async()=>{
 const f=fixture(),adapter=trustedLedger(f);
 const wrapped={async lookupAuthorized(i){await adapter.lookupAuthorized(i);
  throw Error("database temporarily unavailable");}};
 await assert.rejects(reconcileAuthorizedTypedNote(wrapped,"operator",note),
  /temporarily unavailable/);
});
test("unsupported client flags and malformed requests rejected before any lookup",async()=>{
 const f=fixture(),adapter=trustedLedger(f);
 for(const req of [
  {...note,approved:true},{...note,send:true},{...note,sourceId:randomUUID()},
  {...note,requestId:"../foo"},{...note,organizationId:"invalid"},
  {...note,text:" "},{...note,text:"a".repeat(65537)},null,
 ]){
  await assert.rejects(reconcileAuthorizedTypedNote(adapter,"operator",req),/Invalid/);
 }
 assert.equal(adapter.count(),0);
});
test("different authorized actor does not inherit another actor's request ID",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 const actor="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
 f.members.set("other-member",{org:ORG,actor,create:true});
 const result=await reconcileAuthorizedTypedNote(trustedLedger(f),"other-member",note);
 assert.equal(result.state,"not-found-at-read");
 assert.equal(f.records.has(created.sourceId),true);
});

test("ledger reconciliation rejects forged candidate pricing hidden from digest",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 const row=advanceToExtraction(f,created.sourceId);
 row.review.candidates[0].rateCents=1234;
 assert.equal((await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",note)).state,
  "conflict");
});
test("ledger reconciliation rejects extra top-level persisted approval fields",async()=>{
 const f=fixture(),created=await commitAuthorizedTypedNote(f.store,"operator",note);
 f.records.get(created.sourceId).approved=true;
 assert.equal((await reconcileAuthorizedTypedNote(trustedLedger(f),"operator",note)).state,
  "conflict");
});
