import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commitAuthorizedTypedNote } from "../lib/tenant-typed-note-source.ts";
import { readExtractionPreparation } from "../lib/tenant-extraction-service.ts";

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
