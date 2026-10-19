import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commitAuthorizedTypedNote, verifyTypedNoteSourceRecord } from "../lib/tenant-typed-note-source.ts";
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

test("authorized note creation preserves original and stays unreviewed", async () => {
  const f = fixture(), result = await commitAuthorizedTypedNote(f.store, "operator", note);
  assert.equal(result.state, "ready-for-extraction");
  assert.equal(result.revision, 1);
  assert.match(result.sourceId, /^[a-f0-9-]{36}$/);
  assert.match(result.textSha256, /^[a-f0-9]{64}$/);
  const stored = f.records.get(result.sourceId);
  assert.deepEqual(stored.original, {kind:"typed-note",text:note.text});
  assert.equal(stored.creationAudit.actorId, ACTOR);
  assert.equal(stored.creationAudit.requestId, REQUEST);
  assert.equal(stored.creationAudit.textSha256, result.textSha256);
  assert.deepEqual(stored.extractionAudit, []);
  assert.equal(stored.scopeReview, null);
  assert.equal(stored.review, null);
  assert.equal(Object.hasOwn(result, "send"), false);
  assert.equal(Object.hasOwn(result, "approved"), false);
});
test("concurrent identical requests create one durable source only", async () => {
  const f = fixture();
  const [a, b, c] = await Promise.all([
    commitAuthorizedTypedNote(f.store, "operator", note),
    commitAuthorizedTypedNote(f.store, "operator", note),
    commitAuthorizedTypedNote(f.store, "operator", note)]);
  assert.deepEqual(a, b); assert.deepEqual(b, c);
  assert.equal(f.calls().count, 1);
  assert.equal(f.ledger.size, 1);
});
test("reused idempotency key with different note is rejected and original intact", async () => {
  const f = fixture();
  const first = await commitAuthorizedTypedNote(f.store, "operator", note);
  await assert.rejects(commitAuthorizedTypedNote(f.store, "operator",
    {...note,text:note.text+" extra"}),/payload conflict/);
  assert.equal(f.records.get(first.sourceId).original.text, note.text);
  assert.equal(f.calls().count, 1);
});
test("a new request id creates a distinct source", async () => {
  const f = fixture();
  const first = await commitAuthorizedTypedNote(f.store, "operator", note);
  const second = await commitAuthorizedTypedNote(f.store, "operator",
    {...note,requestId:"22222222-2222-4222-8222-222222222222"});
  assert.notEqual(first.sourceId,second.sourceId);
  assert.equal(f.calls().count,2);
});
test("foreign, viewer-only and revoked sessions fail at atomic creation", async () => {
  const f = fixture();
  await assert.rejects(commitAuthorizedTypedNote(f.store,"foreign",note),/Unauthorized/);
  await assert.rejects(commitAuthorizedTypedNote(f.store,"reader",note),/Unauthorized/);
  f.hooks(() => f.members.delete("operator"));
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note),/Unauthorized/);
  assert.equal(f.calls().count,0);
});
test("invalid and forged client directives fail before writing", async () => {
  const f = fixture();
  for (const input of [
    {...note,sourceId:randomUUID()}, {...note,actorId:ACTOR},
    {...note,approved:true}, {...note,send:true}, {...note,rateCents:1},
    {...note,organizationId:"../foreign"}, {...note,requestId:"bad"},
    {...note,text:" "}, {...note,text:"a".repeat(65537)},
    {...note,text:"\u0000"}, {...note,text:"\uD800"}, {...note,text:"\uDC00"}, null,
  ]) await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",input),/Invalid/);
  assert.equal(f.calls().count,0);
});
test("UTF-8 byte limit applies to non-ASCII and original whitespace is preserved", async () => {
  const f = fixture();
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",
    {...note,text:"🧱".repeat(16385)}),/Invalid/);
  const original="  Repair 2 doors.\r\nNo markup.\t";
  const r=await commitAuthorizedTypedNote(f.store,"operator",{...note,text:original});
  assert.equal(f.records.get(r.sourceId).original.text,original);
});
test("forged server actor, source identity, audit or creation result never confirms", async () => {
  for(const mode of ["actor","id","text","audit","extra-fields"]) {
    const f=fixture();
    const store={readAuthorized:f.store.readAuthorized,
      async createAuthorized(opts) {
        const result=await f.store.createAuthorized(opts);
        if(mode==="actor") return {...result,authenticatedActorId:randomUUID()};
        if(mode==="id") return {...result,record:{...result.record,sourceId:"invalid"}};
        if(mode==="text") return {...result,record:{...result.record,
          original:{kind:"typed-note",text:"altered"}}};
        if(mode==="audit") return {...result,record:{...result.record,
          creationAudit:{...result.record.creationAudit,requestId:randomUUID()}}};
        return {...result,record:{...result.record,review:{approved:true}}};
      }};
    await assert.rejects(commitAuthorizedTypedNote(store,"operator",note));
  }
});
test("fabricated success without a durable record fails authorized read-back", async () => {
  const f=fixture();
  const fake={readAuthorized:f.store.readAuthorized,
    async createAuthorized(opts) {return {
      record:opts.materialize({sourceId:randomUUID(),authenticatedActorId:ACTOR}),
      authenticatedActorId:ACTOR};
    }};
  await assert.rejects(commitAuthorizedTypedNote(fake,"operator",note),
    /did not confirm/);
  assert.equal(f.calls().count,0);
});
test("source tampered before read-back fails even when create response was authentic", async () => {
  const f=fixture();
  f.hooks(()=>{},()=>{for(const row of f.records.values()) row.original.text="tampered";});
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note),
    /did not confirm/);
});
test("revocation after atomic commit denies success but leaves durable source to reconcile", async () => {
  const f=fixture();
  f.hooks(()=>{},()=>f.members.delete("operator"));
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note),/Unauthorized/);
  assert.equal(f.calls().count,1);
});
test("new typed note is directly eligible for existing extraction preparation, not an approved quote", async () => {
  const f=fixture();
  const saved=await commitAuthorizedTypedNote(f.store,"operator",note);
  const prep=await readExtractionPreparation(f.store,"operator",{
    organizationId:ORG,sourceId:saved.sourceId});
  assert.equal(prep.state,"ready-for-extraction");
  assert.equal(prep.expectedRevision,1);
  assert.match(prep.expectedSnapshotSha256,/^[a-f0-9]{64}$/);
  assert.equal(f.records.get(saved.sourceId).review,null);
});


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
test("same idempotency key finds a processed extraction without creating a duplicate",async()=>{
  const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
  advanceToExtraction(f,created.sourceId);
  const replay=await commitAuthorizedTypedNote(f.store,"operator",note);
  assert.deepEqual(replay,{...created,state:"existing-source",revision:2});
  assert.equal(f.calls().count,1);
  assert.equal(f.ledger.size,1);
  assert.equal(f.records.get(created.sourceId).review.state,"needs-human-review");
});
test("same idempotency key finds committed reviewed scope but never returns ready status",async()=>{
  const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
  advanceToScope(f,created.sourceId);
  const replay=await commitAuthorizedTypedNote(f.store,"operator",note);
  assert.equal(replay.state,"existing-source");
  assert.equal(replay.revision,3);
  assert.equal(replay.sourceId,created.sourceId);
  assert.equal(Object.hasOwn(replay,"approved"),false);
  assert.equal(Object.hasOwn(replay,"send"),false);
  assert.equal(f.calls().count,1);
});
test("changed payload cannot reuse key even after the original note was extracted",async()=>{
  const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
  advanceToExtraction(f,created.sourceId);
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",
    {...note,text:"Paint 200 rooms"}),/payload conflict/);
  assert.equal(f.calls().count,1);
});
test("an unauthorized operator may not replay a previously committed note",async()=>{
  const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
  advanceToExtraction(f,created.sourceId);
  f.members.delete("operator");
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note),/Unauthorized/);
  assert.equal(f.calls().count,1);
});
test("advanced record tampering fails without reissuing source identity",async()=>{
  for (const mutation of [
    row=>{row.original.text="Different text"},
    row=>{row.creationAudit.actorId=randomUUID()},
    row=>{row.review.candidates[0].excerpt="Wrong excerpt"},
    row=>{row.review.candidatesSha256="f".repeat(64)},
    row=>{row.extractionAudit[0].actorId="forged"},
    row=>{row.extractionAudit[0].sourceRevision=1},
    row=>{row.review=null},
    row=>{row.scopeReview={approved:true}},
  ]){
    const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
    const row=advanceToExtraction(f,created.sourceId);mutation(row);
    await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note));
    assert.equal(f.calls().count,1);
  }
});
test("processed reviewed scope rejects forged approval, add-ons and source revision",async()=>{
  for(const mutation of [
    row=>{row.scopeReview.send=true},
    row=>{row.scopeReview.acceptedAddonCodes=["unselected"]},
    row=>{row.scopeReview.selectedIndices=[99]},
    row=>{row.scopeReview.reviewedBy="attacker"},
    row=>{row.scopeReview.sourceSha256="f".repeat(64)},
    row=>{row.revision=4},
  ]){
    const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
    const row=advanceToScope(f,created.sourceId);mutation(row);
    await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note));
    assert.equal(f.calls().count,1);
  }
});
test("progression between authorized create result and read-back is indeterminate",async()=>{
  const f=fixture();const created=await commitAuthorizedTypedNote(f.store,"operator",note);
  let mutated=false;
  const adapter={
    async createAuthorized(input){return f.store.createAuthorized(input)},
    async readAuthorized(input){if(!mutated){mutated=true;advanceToExtraction(f,created.sourceId)}
      return f.store.readAuthorized(input)}
  };
  await assert.rejects(commitAuthorizedTypedNote(adapter,"operator",note),/read-back differs/);
  assert.equal(f.calls().count,1);
});

test("authorized primary read-back tolerates JSON object key reordering",async()=>{
  const f=fixture();
  const adapter={createAuthorized:f.store.createAuthorized,
    async readAuthorized(input){
      const row=await f.store.readAuthorized(input);
      const reverse=(x)=>Object.fromEntries(Object.entries(x).reverse());
      return {...reverse(row),original:reverse(row.original),
        creationAudit:reverse(row.creationAudit)};
    }};
  const first=await commitAuthorizedTypedNote(adapter,"operator",note);
  assert.equal(first.state,"ready-for-extraction");
  assert.equal(first.revision,1);
  assert.equal(f.calls().count,1);
});
test("rejects extra persisted source or original directives even with matching hashes",async()=>{
  for(const corrupt of [
    row=>{row.send=true},
    row=>{row.approved=true},
    row=>{row.original.rateCents=1},
    row=>{row.original.approved=true},
  ]){
    const f=fixture(),saved=await commitAuthorizedTypedNote(f.store,"operator",note);
    corrupt(f.records.get(saved.sourceId));
    await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note));
    assert.equal(f.calls().count,1);
  }
});
test("rejects model-supplied price and approvals hidden in otherwise valid candidate digests",async()=>{
  for(const corrupt of [
    row=>{row.review.candidates[0].rateCents=1},
    row=>{row.review.candidates[0].send=true},
    row=>{row.review.candidates[0].approved=true},
    row=>{row.review.approved=true},
  ]){
    const f=fixture(),saved=await commitAuthorizedTypedNote(f.store,"operator",note);
    const row=advanceToExtraction(f,saved.sourceId);
    corrupt(row);
    await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note));
    assert.equal(f.calls().count,1);
  }
});


test("a forged extraction actor cannot be hidden behind valid source and candidate hashes",async()=>{
  const f=fixture();
  const created=await commitAuthorizedTypedNote(f.store,"operator",note);
  const row=advanceToExtraction(f,created.sourceId);
  row.extractionAudit[0].actorId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  assert.equal(row.extractionAudit[0].sourceSha256,row.review.sourceSha256);
  assert.equal(row.extractionAudit[0].candidatesSha256,row.review.candidatesSha256);
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",note),
    /extraction progression is invalid/);
  assert.equal(f.calls().count,1);
  assert.equal(f.ledger.size,1);
});

test("source selectors reject hidden, symbolic, inherited and accessor directives",async()=>{
 const f=fixture(), hidden={...note}, symbol={...note}, accessor={...note};
 let getterCalls=0;
 Object.defineProperty(hidden,"send",{value:true,enumerable:false});
 symbol[Symbol("approved")]=true;
 Object.defineProperty(accessor,"text",{
  enumerable:true,get(){getterCalls++;return note.text;}
 });
 const inherited=Object.assign(Object.create({send:true}),note);
 for(const input of [hidden,symbol,accessor,inherited]){
  await assert.rejects(commitAuthorizedTypedNote(f.store,"operator",input),/Invalid/);
 }
 assert.equal(getterCalls,0,"Untrusted accessor must not execute during validation");
 assert.equal(f.calls().count,0);
});

test("stored source, extraction and approved-scope objects reject hidden and accessor data",async()=>{
 const f=fixture(),saved=await commitAuthorizedTypedNote(f.store,"operator",note);
 const base=f.records.get(saved.sourceId);
 const check=record=>verifyTypedNoteSourceRecord(
  record,note,saved.textSha256,ACTOR);
 let hits=0;
 const original=structuredClone(base);
 Object.defineProperty(original.original,"text",{
  enumerable:true,get(){hits++;return note.text;}
 });
 assert.throws(()=>check(original),/immutable original/);
 const hidden=structuredClone(base);
 Object.defineProperty(hidden.creationAudit,"send",{value:true});
 assert.throws(()=>check(hidden),/immutable original/);
 const symbol=structuredClone(base);
 symbol[Symbol("approved")]=true;
 assert.throws(()=>check(symbol),/immutable original/);
 const reviewed=structuredClone(base);
 reviewed.revision=2;
 reviewed.review=prepareExtractionReview(reviewed.original,[{
  serviceCode:"painting",units:2,start:0,end:13,excerpt:"Paint 2 rooms"
 }]);
 reviewed.extractionAudit=[{sourceRevision:2,actorId:ACTOR,
  sourceSha256:reviewed.review.sourceSha256,
  candidatesSha256:reviewed.review.candidatesSha256}];
 Object.defineProperty(reviewed.review.candidates[0],"send",{value:true});
 assert.throws(()=>check(reviewed),/extraction progression/);
 const scoped=structuredClone(reviewed);
 delete scoped.review.candidates[0].send;
 scoped.revision=3;
 scoped.scopeReview={sourceRevision:3,reviewedBy:ACTOR,
  reviewKey:"a".repeat(64),sourceSha256:scoped.review.sourceSha256,
  candidatesSha256:scoped.review.candidatesSha256,selectedIndices:[0],
  acceptedAddonCodes:[],policyRevision:1,policySha256:"b".repeat(64),
  reviewedSelectionSha256:"c".repeat(64),state:"reviewed-for-proposal-draft"};
 Object.defineProperty(scoped.scopeReview,"send",{value:true});
 assert.throws(()=>check(scoped),/reviewed scope progression/);
 assert.equal(hits,0);
});

test("in-flight caller mutations cannot retarget typed note storage or confirmation",async()=>{
 const f=fixture(),input={...note};
 const initial={...note};
 const adapter={
  async createAuthorized(args){
   input.organizationId=OTHER;
   input.requestId=randomUUID();
   input.text="Forged after initial validation";
   return f.store.createAuthorized(args);
  },
  async readAuthorized(args){
   input.organizationId=OTHER;
   input.text="Mutated while reading";
   return f.store.readAuthorized(args);
  }
 };
 const saved=await commitAuthorizedTypedNote(adapter,"operator",input);
 assert.equal(saved.organizationId,initial.organizationId);
 assert.equal(saved.state,"ready-for-extraction");
 const row=f.records.get(saved.sourceId);
 assert.equal(row.original.text,initial.text);
 assert.equal(row.creationAudit.requestId,initial.requestId);
 assert.equal(f.calls().count,1);
});

test("canonical null-prototype typed-note request remains valid",async()=>{
 const f=fixture();
 const input=Object.assign(Object.create(null),note);
 const saved=await commitAuthorizedTypedNote(f.store,"operator",input);
 assert.equal(saved.state,"ready-for-extraction");
 assert.equal(f.calls().count,1);
});
