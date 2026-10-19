import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTrustedTypedNoteLedger }
  from "../lib/trusted-typed-note-ledger.ts";
import { reconcileAuthorizedTypedNote }
  from "../lib/typed-note-reconciliation.ts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REQUEST = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const request = { organizationId: ORG, requestId: REQUEST,
  text: "Clean 2 rooms. No subcontractor." };
const digest = createHash("sha256").update(request.text).digest("hex");
const record = { organizationId: ORG, sourceId: SOURCE, revision: 1,
  original: {kind: "typed-note", text: request.text}, review: null,
  extractionAudit: [], scopeReview: null,
  creationAudit: {actorId: ACTOR, requestId: REQUEST, textSha256: digest} };

function fixture() {
  let active = true;
  const authCalls = [], sqlCalls = [];
  const auth = {
    async verifyActiveSession(session) {
      authCalls.push(session);
      if (!active || session !== "real-session") {
        throw new Error("Auth session invalid or revoked");
      }
      return { userId: ACTOR };
    },
  };
  const database = {
    async query(sql, params) {
      sqlCalls.push({ sql, params });
      if (params[0] !== ORG || params[1] !== ACTOR) {
        throw new Error("Current tenant membership required");
      }
      if (params[2] !== REQUEST) return { rows: [] };
      return { rows: [{authenticated_actor_id: ACTOR, text_sha256: digest,
        record: structuredClone(record)}] };
    },
  };
  return { auth, database, authCalls, sqlCalls, revoke: () => {active = false;} };
}

test("pre- and post-query Auth checks on both primary reads confirm original receipt", async () => {
  const f = fixture();
  const ledger = createTrustedTypedNoteLedger(f.auth, f.database);
  const result = await reconcileAuthorizedTypedNote(ledger, "real-session", request);
  assert.deepEqual(result, { state: "confirmed-unprocessed",
    organizationId: ORG, sourceId: SOURCE, revision: 1, textSha256: digest });
  assert.deepEqual(f.authCalls, Array(4).fill("real-session"));
  assert.equal(f.sqlCalls.length, 2);
  for (const call of f.sqlCalls) {
    assert.match(call.sql, /bm_intake_private\.lookup_typed_note\(\$1::uuid, \$2::uuid, \$3::uuid\)/);
    assert.deepEqual(call.params, [ORG, ACTOR, REQUEST]);
    assert.doesNotMatch(call.sql, /insert|update|delete/i);
  }
});

test("absent authorized ledger key remains read-only and not proof of rollback", async () => {
  const f = fixture();
  const result = await reconcileAuthorizedTypedNote(
    createTrustedTypedNoteLedger(f.auth, f.database), "real-session",
    {...request, requestId:"33333333-3333-4333-8333-333333333333"});
  assert.equal(result.state, "not-found-at-read");
  assert.equal(f.sqlCalls.length, 2);
  assert.equal(f.authCalls.length, 4);
});

test("caller cannot declare or override authenticated actor or authorization", async () => {
  const f = fixture(), ledger = createTrustedTypedNoteLedger(f.auth, f.database);
  await assert.rejects(ledger.lookupAuthorized({
    organizationId: ORG, requestId: REQUEST, session: "real-session",
    permission: "create-intake", actorId: OTHER_ACTOR,
  }), /Invalid private/);
  await assert.rejects(ledger.lookupAuthorized({
    organizationId: ORG, requestId: REQUEST, session: {userId: ACTOR},
    permission: "create-intake",
  }), /Auth session/);
  await assert.rejects(ledger.lookupAuthorized({
    organizationId: OTHER_ORG, requestId: REQUEST,
    session: "real-session", permission: "create-intake",
  }), /Current tenant membership/);
  assert.equal(f.sqlCalls.length, 1);
  assert.deepEqual(f.sqlCalls[0].params, [OTHER_ORG, ACTOR, REQUEST]);
});

test("revocation during a primary receipt read denies even the first result", async () => {
  const f = fixture(), original = f.database.query;
  f.database.query = async (...args) => {
    const response = await original(...args);
    f.revoke();
    return response;
  };
  await assert.rejects(reconcileAuthorizedTypedNote(
    createTrustedTypedNoteLedger(f.auth, f.database),
    "real-session", request), /revoked/);
  assert.equal(f.sqlCalls.length, 1);
  assert.equal(f.authCalls.length, 2);
});

test("revocation during a primary lookup denies both a receipt and a missing-key result", async () => {
  for (const requestId of [REQUEST, "33333333-3333-4333-8333-333333333333"]) {
    const f = fixture(), original = f.database.query;
    f.database.query = async (...args) => {
      const response = await original(...args);
      f.revoke();
      return response;
    };
    await assert.rejects(createTrustedTypedNoteLedger(f.auth, f.database)
      .lookupAuthorized({organizationId: ORG, requestId,
        session:"real-session", permission:"create-intake"}), /revoked/);
    assert.equal(f.sqlCalls.length, 1);
    assert.equal(f.authCalls.length, 2);
  }
});

test("actor switching while a primary lookup is in flight fails closed", async () => {
  for (const requestId of [REQUEST, "33333333-3333-4333-8333-333333333333"]) {
    const f = fixture(), original = f.database.query;
    let identity = ACTOR, checks = 0;
    f.auth.verifyActiveSession = async () => {
      checks++;
      return {userId: identity};
    };
    f.database.query = async (...args) => {
      const response = await original(...args);
      identity = OTHER_ACTOR;
      return response;
    };
    await assert.rejects(createTrustedTypedNoteLedger(f.auth, f.database)
      .lookupAuthorized({organizationId: ORG, requestId,
        session:"real-session", permission:"create-intake"}), /actor changed/);
    assert.equal(checks, 2);
    assert.equal(f.sqlCalls.length, 1);
  }
});

test("invalid selector or permission never invokes Auth or SQL", async () => {
  const f = fixture(), ledger = createTrustedTypedNoteLedger(f.auth, f.database);
  for (const overrides of [
    {organizationId: "invalid"}, {requestId: "../other"},
    {permission: "read-all"}, {sourceId: SOURCE},
    {requestId: null},
  ]) {
    await assert.rejects(ledger.lookupAuthorized({
      organizationId: ORG, requestId: REQUEST,
      session: "real-session", permission: "create-intake", ...overrides,
    }), /Invalid private/);
  }
  assert.equal(f.authCalls.length, 0);
  assert.equal(f.sqlCalls.length, 0);
});

test("missing or forged verified Auth identity rejects before SQL", async () => {
  for (const identity of [null, undefined, {}, {userId: "invalid"},
    {userId: ACTOR, role: "admin"}, {userId: OTHER_ACTOR.toUpperCase()}]) {
    const f = fixture();
    f.auth.verifyActiveSession = async () => identity;
    await assert.rejects(createTrustedTypedNoteLedger(f.auth, f.database)
      .lookupAuthorized({organizationId:ORG, requestId:REQUEST,
        session:"real-session", permission:"create-intake"}), /Verified active Auth/);
    assert.equal(f.sqlCalls.length, 0);
  }
});

test("database actor, digest, shape and cardinality mismatches fail closed", async () => {
  const base = {authenticated_actor_id: ACTOR, text_sha256: digest,
    record: structuredClone(record)};
  const invalid = [
    null, {}, {rows: null}, {rows: [base, base]}, {rows: [null]},
    {rows: [{...base, authenticated_actor_id: OTHER_ACTOR}]},
    {rows: [{...base, text_sha256: "bad"}]},
    {rows: [{...base, record: null}]},
    {rows: [{...base, record: JSON.stringify(record)}]},
    {rows: [{...base, approved: true}]},
  ];
  for (const response of invalid) {
    const f = fixture();
    f.database.query = async () => response;
    await assert.rejects(createTrustedTypedNoteLedger(f.auth, f.database)
      .lookupAuthorized({organizationId:ORG, requestId:REQUEST,
        session:"real-session", permission:"create-intake"}));
  }
});

test("tampered source cannot be confirmed by apparently valid private receipt", async () => {
  const f = fixture();
  f.database.query = async () => ({rows: [{
    authenticated_actor_id:ACTOR, text_sha256:digest,
    record:{...record, original:{kind:"typed-note", text:"forged"}},
  }]});
  assert.equal((await reconcileAuthorizedTypedNote(
    createTrustedTypedNoteLedger(f.auth,f.database),
    "real-session",request)).state, "conflict");
});

test("database outages propagate, never become a valid absent ledger", async () => {
  const f = fixture();
  f.database.query = async () => {throw new Error("primary database unavailable");};
  await assert.rejects(reconcileAuthorizedTypedNote(
    createTrustedTypedNoteLedger(f.auth, f.database),
    "real-session", request), /primary database unavailable/);
});
