import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTrustedReceiptWriter } from "../lib/supabase-receipt-writer.ts";
import { ingestVerifiedEvidence } from "../lib/evidence.ts";

const org = "10000000-0000-4000-8000-000000000001";
const wrong = "10000000-0000-4000-8000-000000000002";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const object = "50000000-0000-4000-8000-000000000001";
const bytes = Buffer.from("%PDF-1.7\n% synthetic evidence\n");
const receipt = {
  organization_id: org,
  object_path: org + "/" + object + ".pdf",
  content_sha256: createHash("sha256").update(bytes).digest("hex"),
  byte_length: bytes.length,
  content_type: "application/pdf",
};

function mockWriter(status=201) {
  const requests = [];
  const write = createTrustedReceiptWriter({
    secretKey: "sb_secret_ci_never_actual_secret",
    organizationId: org,
    http: async (url, options) => {
      requests.push({url: String(url), options});
      return new Response(status === 204 ? null : "", {status});
    },
  });
  return {write, requests};
}

test("fails closed without a server secret key and canonical tenant", () => {
  for (const secretKey of ["", "sb_publishable_wrong", "Bearer user.jwt"]) {
    assert.throws(() => createTrustedReceiptWriter({
      secretKey, organizationId: org,
    }), /not configured/);
  }
  assert.throws(() => createTrustedReceiptWriter({
    secretKey: "sb_secret_looks_like_key", organizationId: "../unauthorized",
  }), /not configured/);
});

test("sends only validated immutable receipt fields to fixed BidMason server via secret-key apikey", async () => {
  const {write, requests} = mockWriter();
  await write({...receipt, created_by: actor, id: object, received_at: "forged"});
  assert.equal(requests.length, 1);
  const [{url,options}] = requests;
  assert.equal(url, "https://jgbogpunyzkoytrclqdl.supabase.co/rest/v1/bm_evidence_receipts");
  assert.equal(options.headers.apikey, "sb_secret_ci_never_actual_secret");
  assert.equal(options.headers.Prefer, "return=minimal");
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.deepEqual(JSON.parse(options.body), receipt);
});

test("cross-tenant path, mismatched MIME, corrupt hash and impossible size cannot touch privileged endpoint", async () => {
  const {write,requests} = mockWriter();
  for (const candidate of [
    {...receipt, organization_id: wrong},
    {...receipt, object_path: wrong + "/" + object + ".pdf"},
    {...receipt, object_path: "../bad/file.pdf"},
    {...receipt, object_path: org + "/" + object + ".jpg"},
    {...receipt, content_sha256: "0"},
    {...receipt, byte_length: 0},
    {...receipt, byte_length: 15*1024*1024+1},
  ]) await assert.rejects(write(candidate), /Invalid/);
  assert.equal(requests.length, 0);
});

test("duplicate conflicts, denied grants, upstream outages and network faults reject with no leaked response", async () => {
  for (const status of [200,204,400,401,403,409,500]) {
    const {write,requests} = mockWriter(status);
    await assert.rejects(write(receipt), /insertion rejected/);
    assert.equal(requests.length, 1);
  }
  const write = createTrustedReceiptWriter({
    secretKey: "sb_secret_ci_never_actual_secret",
    organizationId: org,
    http: async () => { throw Error("internal API key from provider"); },
  });
  await assert.rejects(write(receipt), err =>
    err.message === "Trusted evidence receipt service unavailable");
});

test("receipt writer is unreachable after denied authorization or mismatched private bytes", async () => {
  const {write,requests} = mockWriter();
  const blocked = {
    authorize: async () => false,
    uploadPrivate: async () => {throw Error("must not upload");},
    readBackPrivate: async () => {throw Error("must not read");},
    issueTrustedReceipt: write,
  };
  await assert.rejects(ingestVerifiedEvidence(actor,org,"application/pdf",
    bytes, blocked, ()=>object), /Not authorized/);
  const tampered = {
    authorize: async () => true,
    uploadPrivate: async () => {},
    readBackPrivate: async () => Buffer.from("%PDF-1.7\nchanged\n"),
    issueTrustedReceipt: write,
  };
  await assert.rejects(ingestVerifiedEvidence(actor,org,"application/pdf",
    bytes, tampered, ()=>object), /differ/);
  assert.equal(requests.length,0);
});

test("successful full ingestion reaches privileged writer only after two authorization checks and verified readback", async () => {
  const {write,requests} = mockWriter();
  const steps = [];
  const port = {
    authorize: async (userId, orgId) => {
      assert.equal(userId, actor);
      assert.equal(orgId, org);
      steps.push("authorize");
      return true;
    },
    uploadPrivate: async (_, metadata, uploaded) => {
      steps.push("upload");
      assert.deepEqual(uploaded, bytes);
      assert.equal(metadata.object_path, receipt.object_path);
    },
    readBackPrivate: async () => {
      steps.push("readback");
      return new Uint8Array(bytes);
    },
    issueTrustedReceipt: async metadata => {
      steps.push("issue");
      await write(metadata);
    },
  };
  const saved = await ingestVerifiedEvidence(actor,org,"application/pdf",
    bytes, port,()=>object);
  assert.deepEqual(steps, ["authorize","upload","readback","authorize","issue"]);
  assert.equal(requests.length,1);
  assert.deepEqual(JSON.parse(requests[0].options.body),saved);
});
