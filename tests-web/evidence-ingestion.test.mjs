import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ingestVerifiedEvidence } from "../lib/evidence.ts";

const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const org = "10000000-0000-4000-8000-000000000001";
const object = "50000000-0000-4000-8000-000000000001";
const bytes = new Uint8Array(Buffer.from("%PDF-1.7\n% authorized synthetic data\n"));

function mockPort(opts = {}) {
  const calls = [];
  const port = {
    async authorize(actor, tenant) {
      calls.push("authorize");
      assert.equal(actor, user);
      assert.equal(tenant, org);
      return opts.authorize ? opts.authorize(calls.filter(x => x === "authorize").length) : true;
    },
    async uploadPrivate(actor, receipt, supplied) {
      calls.push("upload");
      assert.equal(receipt.organization_id, org);
      assert.equal(actor, user);
      assert.ok(supplied instanceof Uint8Array);
      if (opts.failUpload) throw Error("upload failed");
    },
    async readBackPrivate(actor, receipt) {
      calls.push("readBack");
      assert.equal(actor, user);
      assert.match(receipt.object_path, /\.pdf$/);
      return opts.readBack ?? bytes;
    },
    async issueTrustedReceipt(receipt) {
      calls.push("receipt");
      if (opts.failReceipt) throw Error("receipt insert failed");
      assert.equal(receipt.byte_length, bytes.length);
    },
  };
  return { port, calls };
}

test("authorized upload, matching private readback, final membership check then trusted receipt", async () => {
  const { port, calls } = mockPort();
  const receipt = await ingestVerifiedEvidence(user, org, "application/pdf", bytes, port, () => object);
  assert.deepEqual(calls, ["authorize", "upload", "readBack", "authorize", "receipt"]);
  assert.equal(receipt.content_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(receipt.object_path, org + "/" + object + ".pdf");
});

test("unauthorized actor cannot upload or mint a receipt", async () => {
  const { port, calls } = mockPort({ authorize: () => false });
  await assert.rejects(ingestVerifiedEvidence(user, org, "application/pdf", bytes, port, () => object), /Not authorized/);
  assert.deepEqual(calls, ["authorize"]);
});

test("content replacement or missing object prevents a trusted receipt", async () => {
  for (const readBack of [
    new Uint8Array(Buffer.from("%PDF-1.7\n% tampered but valid signature\n")),
    new Uint8Array(),
  ]) {
    const { port, calls } = mockPort({ readBack });
    await assert.rejects(ingestVerifiedEvidence(user, org, "application/pdf", bytes, port, () => object));
    assert.deepEqual(calls, ["authorize", "upload", "readBack"]);
  }
});

test("membership revoked after upload blocks receipt issuance", async () => {
  const { port, calls } = mockPort({ authorize: n => n === 1 });
  await assert.rejects(ingestVerifiedEvidence(user, org, "application/pdf", bytes, port, () => object), /revoked/);
  assert.deepEqual(calls, ["authorize", "upload", "readBack", "authorize"]);
});

test("input mutation while waiting for authorization cannot change the uploaded copy", async () => {
  const original = Uint8Array.from(bytes);
  const toMutate = Uint8Array.from(bytes);
  const port = {
    authorize: async () => {
      toMutate.fill(0);
      return true;
    },
    uploadPrivate: async (_, __, data) => assert.deepEqual(data, original),
    readBackPrivate: async () => original,
    issueTrustedReceipt: async () => {},
  };
  await ingestVerifiedEvidence(user, org, "application/pdf", toMutate, port, () => object);
});

test("bad IDs, MIME, missing input, or failed network calls cannot mint receipts", async () => {
  const { port, calls } = mockPort();
  await assert.rejects(ingestVerifiedEvidence("not-an-id", org, "application/pdf", bytes, port, () => object), /Invalid/);
  await assert.rejects(ingestVerifiedEvidence(user, org, "text/plain", bytes, port, () => object), /Unsupported/);
  await assert.rejects(ingestVerifiedEvidence(user, org, "application/pdf", new Uint8Array(), port, () => object), RangeError);
  assert.deepEqual(calls, []);
  const failed = mockPort({ failUpload: true });
  await assert.rejects(ingestVerifiedEvidence(user, org, "application/pdf", bytes, failed.port, () => object), /upload failed/);
  assert.deepEqual(failed.calls, ["authorize", "upload"]);
  const noReceipt = mockPort({ failReceipt: true });
  await assert.rejects(ingestVerifiedEvidence(user, org, "application/pdf", bytes, noReceipt.port, () => object), /receipt insert failed/);
  assert.deepEqual(noReceipt.calls, ["authorize", "upload", "readBack", "authorize", "receipt"]);
});
