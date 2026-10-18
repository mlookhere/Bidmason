import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareEvidenceReceipt, ingestVerifiedEvidence } from "../lib/evidence.ts";

const org = "10000000-0000-4000-8000-000000000001";
const object = "50000000-0000-4000-8000-000000000001";
const pdf = Buffer.from("%PDF-1.7\n% synthetic fixture\n", "utf8");

test("derives immutable candidate receipt fields from PDF bytes, never a supplied hash", () => {
  const receipt = prepareEvidenceReceipt(org, object, "application/pdf", pdf);
  assert.deepEqual(receipt, {
    organization_id: org,
    object_path: org + "/" + object + ".pdf",
    content_sha256: createHash("sha256").update(pdf).digest("hex"),
    byte_length: pdf.length,
    content_type: "application/pdf",
  });
});

test("normalizes PNG and JPEG extensions from MIME type", () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const jpg = Uint8Array.from([255, 216, 255, 224, 1]);
  assert.equal(prepareEvidenceReceipt(org, object, "image/png", png).object_path, org + "/" + object + ".png");
  assert.equal(prepareEvidenceReceipt(org, object, "image/jpeg", jpg).object_path, org + "/" + object + ".jpg");
});

test("rejects path spoofing, mixed-case IDs, mismatched signatures, and HTML", () => {
  assert.throws(() => prepareEvidenceReceipt("../" + org, object, "application/pdf", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", object, "application/pdf", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt(org, "not-a-uuid", "application/pdf", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "image/png", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "text/html", pdf), TypeError);
});

test("rejects zero-byte, oversize, and nonbinary payloads", () => {
  assert.throws(() => prepareEvidenceReceipt(org, object, "application/pdf", new Uint8Array()), RangeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "application/pdf", new Uint8Array(15 * 1024 * 1024 + 1)), RangeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "application/pdf", "fake payload"), RangeError);
});

test("server-owned abort prevents every subsequent privileged ingestion stage", async () => {
  const phases = ["initial", "firstAuth", "upload", "readback", "finalAuth"];
  for (const phase of phases) {
    const controller = new AbortController();
    const operations = [];
    let authorizations = 0;
    const port = {
      async authorize() {
        operations.push("authorize");
        authorizations++;
        if (phase === "firstAuth" && authorizations === 1
          || phase === "finalAuth" && authorizations === 2) controller.abort();
        return true;
      },
      async uploadPrivate() {
        operations.push("upload");
        if (phase === "upload") controller.abort();
      },
      async readBackPrivate() {
        operations.push("readback");
        if (phase === "readback") controller.abort();
        return pdf;
      },
      async issueTrustedReceipt() {
        operations.push("receipt");
        assert.fail("A cancelled ingestion must never mint a receipt");
      },
    };
    if (phase === "initial") controller.abort();
    await assert.rejects(ingestVerifiedEvidence(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", org, "application/pdf",
      pdf, port, () => object, controller.signal,
    ), /Evidence ingestion cancelled/, phase);
    const expected = {
      initial: [], firstAuth: ["authorize"],
      upload: ["authorize", "upload"],
      readback: ["authorize", "upload", "readback"],
      finalAuth: ["authorize", "upload", "readback", "authorize"],
    }[phase];
    assert.deepEqual(operations, expected, "abort at " + phase);
  }
});

test("nonaborted operation still mints exactly one receipt", async () => {
  let issued = 0;
  const port = {
    async authorize() { return true; },
    async uploadPrivate() {},
    async readBackPrivate() { return pdf; },
    async issueTrustedReceipt() { issued++; },
  };
  const controller = new AbortController();
  const receipt = await ingestVerifiedEvidence(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", org, "application/pdf",
    pdf, port, () => object, controller.signal,
  );
  assert.equal(receipt.byte_length, pdf.length);
  assert.equal(issued, 1);
});
