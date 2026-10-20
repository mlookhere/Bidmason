import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {renderSyntheticProposalReview, syntheticSnapshotSha256}
  from "../lib/synthetic-proposal-review.ts";

const sha = bytes=>createHash("sha256").update(bytes).digest("hex");
const fixtures=["painting","cleaning"].map(company=>
  JSON.parse(readFileSync(new URL("../fixtures/synthetic_"+company+"_proposal.json",import.meta.url),"utf8")));
const pdf=Buffer.alloc(3000,1);
const evidence=snapshot=>({
  format:"synthetic-proposal-integrity-v1",disposition:"INTERNAL ONLY - NOT FOR DELIVERY",
  reference:snapshot.proposal.reference,revision:3,
  snapshotSha256:syntheticSnapshotSha256(snapshot),pdfSha256:sha(pdf),
  pdfBytes:pdf.length,pageCount:1,
});

test("Both fictional businesses receive readable, explicitly blocked QA review reports",()=>{
  for(const snapshot of fixtures){
    const output=renderSyntheticProposalReview(snapshot,evidence(snapshot),pdf);
    assert.match(output,/<!doctype html>/i);
    assert.match(output,/<main>/);
    assert.match(output,/<table>/);
    assert.match(output,/BLOCKED - SYNTHETIC INTERNAL DRAFT - NOT FOR DELIVERY/);
    assert.match(output,/Pricing policy<\/td><td>NOT RUN/);
    assert.match(output,/PDF integrity<\/td><td>PASSED/);
    assert.match(output,/No authenticated operator or contractor approval exists/);
    assert.ok(output.includes(snapshot.brand.businessName));
    assert.ok(output.includes(snapshot.proposal.recipient));
    assert.doesNotMatch(output,/<form\b|<input\b|<button\b|<script\b|<a\s+href/);
    assert.match(output,/name="robots" content="noindex/);
    assert.match(output,/Content-Security-Policy/);
  }
});

test("Swapped, edited, stale and malformed artifacts fail before an HTML report exists",()=>{
  for(const snapshot of fixtures){
    const e=evidence(snapshot);
    for(const altered of [
      {...e,pdfSha256:"0".repeat(64)},
      {...e,snapshotSha256:"0".repeat(64)},
      {...e,reference:"SYN-SWAPPED-999"},
      {...e,disposition:"DELIVERABLE"},
      {...e,pageCount:0},
      {...e,pdfBytes:true},
    ]) assert.throws(()=>renderSyntheticProposalReview(snapshot,altered,pdf),/mismatch/);
    assert.throws(()=>renderSyntheticProposalReview(snapshot,e,Buffer.from("fake")),/mismatch/);
    const modified=structuredClone(snapshot);
    modified.proposal.recipient="Different fictional recipient";
    assert.throws(()=>renderSyntheticProposalReview(modified,e,pdf),/mismatch/);
  }
});

test("All proposal text is escaped and offline report cannot introduce active controls",()=>{
  const snapshot=structuredClone(fixtures[0]);
  snapshot.proposal.overview="<script>alert('bad')</script>";
  snapshot.proposal.scope[0].work='<img src=x onerror="bad()">';
  snapshot.proposal.lines[0].label="A & B";
  const html=renderSyntheticProposalReview(snapshot,evidence(snapshot),pdf);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;bad()&quot;&gt;"));
  assert.ok(html.includes("A &amp; B"));
  assert.doesNotMatch(html,/<script>|<img\b|onerror="bad/);
  assert.match(html,/BLOCKED/);
});
