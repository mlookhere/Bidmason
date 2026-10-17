import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareEvidenceReceipt } from "../lib/evidence.ts";

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
  assert.throws(() => prepareEvidenceReceipt(org.toUpperCase(), object, "application/pdf", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt(org, "not-a-uuid", "application/pdf", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "image/png", pdf), TypeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "text/html", pdf), TypeError);
});

test("rejects zero-byte, oversize, and nonbinary payloads", () => {
  assert.throws(() => prepareEvidenceReceipt(org, object, "application/pdf", new Uint8Array()), RangeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "application/pdf", new Uint8Array(15 * 1024 * 1024 + 1)), RangeError);
  assert.throws(() => prepareEvidenceReceipt(org, object, "application/pdf", "fake payload"), RangeError);
});
