// Executed only by the required PDF CI job after Python fixture generation.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {
  buildProposalQaReport,
  evaluateSyntheticArtifactQaConsistency,
} from "../lib/proposal-revision-qa.ts";

const directory = process.env.PROPOSAL_CONTRACT_DIR;
if (!directory) throw new Error("PROPOSAL_CONTRACT_DIR required; no precomputed green fixtures");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ids = {
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const actors = ["cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];

// Independently reproduce Python's sorted, compact, ensure_ascii=True JSON digest.
const quoted = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, char =>
  "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" +
    Object.keys(value).sort().map(key => quoted(key) + ":" + canonical(value[key])).join(",") + "}";
  return typeof value === "string" ? quoted(value) : JSON.stringify(value);
}
const digestObject = value => sha(Buffer.from(canonical(value), "utf8"));
const names = ["pricing", "scope", "claims", "recipient", "pdf-layout"];
function qa(manifest, override = {}) {
  const identity = {
    ...ids, revision: manifest.revision,
    sourceSha256: "a".repeat(64), policySha256: "b".repeat(64),
    contentSha256: manifest.snapshotSha256, ...override,
  };
  const checks = names.map(check => ({
    check, state: "passed", evidenceSha256: check === "pdf-layout"
      ? manifest.pdfSha256 : "d".repeat(64), note: "",
  }));
  const report = buildProposalQaReport(identity, checks);
  const receipts = ["operator", "contractor"].map((role, i) => ({
    ...report.identity, role, actorId: actors[i], qaSha256: report.qaSha256,
  }));
  return {report, receipts};
}

const artifacts = await Promise.all(["painting", "cleaning", "painting-unicode"].map(async company => {
  const [{snapshot, manifest}, bytes] = await Promise.all([
    readFile(join(directory, company + ".json"), "utf8").then(JSON.parse),
    readFile(join(directory, company + ".pdf")),
  ]);
  return {company, snapshot, manifest, bytes};
}));

test("Python-generated PDF bytes and canonical JSON match independent Node SHA-256", () => {
  for (const {snapshot, manifest, bytes} of artifacts) {
    assert.equal(digestObject(snapshot), manifest.snapshotSha256);
    assert.equal(sha(bytes), manifest.pdfSha256);
    assert.equal(bytes.length, manifest.pdfBytes);
    assert.equal(manifest.disposition, "INTERNAL ONLY - NOT FOR DELIVERY");
    assert.equal(manifest.revision, 3);
  }
  assert.notEqual(artifacts[0].manifest.snapshotSha256, artifacts[1].manifest.snapshotSha256);
  assert.notEqual(artifacts[0].manifest.snapshotSha256, artifacts[2].manifest.snapshotSha256);
});

test("All real PDF manifests match internal QA and distinct reviewer receipts", () => {
  for (const {manifest} of artifacts) {
    const {report, receipts} = qa(manifest);
    const result = evaluateSyntheticArtifactQaConsistency(report, receipts, manifest);
    assert.equal(result.state, "consistent-internal-only");
    assert.equal(Object.hasOwn(result, "approved"), false);
    assert.equal(Object.hasOwn(result, "deliver"), false);
  }
});

test("Stale/swapped PDF, snapshot, revision and receipt evidence fails closed", () => {
  const [painting, cleaning] = artifacts;
  const {report, receipts} = qa(painting.manifest);
  for (const manifest of [
    {...painting.manifest, pdfSha256: cleaning.manifest.pdfSha256},
    {...painting.manifest, snapshotSha256: cleaning.manifest.snapshotSha256},
    {...painting.manifest, revision: painting.manifest.revision + 1},
    {...painting.manifest, approved: true},
    cleaning.manifest,
  ]) {
    assert.equal(evaluateSyntheticArtifactQaConsistency(report, receipts, manifest).state, "blocked");
  }
  assert.equal(evaluateSyntheticArtifactQaConsistency(report, receipts.slice(0, 1),
    painting.manifest).state, "blocked");
  const changed = qa(painting.manifest, {revision: painting.manifest.revision + 1});
  assert.equal(evaluateSyntheticArtifactQaConsistency(changed.report, changed.receipts,
    painting.manifest).state, "blocked");
  assert.notEqual(sha(Buffer.concat([painting.bytes, Buffer.from("tampered")])),
                  painting.manifest.pdfSha256);
  const updated = structuredClone(painting.snapshot);
  updated.proposal.recipient = "Different fictional recipient";
  assert.notEqual(digestObject(updated), painting.manifest.snapshotSha256);
});
