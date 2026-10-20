import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {renderSyntheticProposalReview, compareSyntheticProposalRevisions, syntheticSnapshotSha256}
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


test("Consecutive revisions show exact scope and price changes and invalidate prior review",()=>{
  const before=structuredClone(fixtures[0]), after=structuredClone(before);
  after.proposal.scope[0].work="Prepare and repaint newly measured vacant units";
  after.proposal.lines[0].unitPriceCents=46250;
  after.proposal.lines[0].lineTotalCents=92500;
  after.proposal.subtotalCents=104500;
  after.proposal.totalCents=104500;
  const prior=evidence(before), next={...evidence(after),revision:4};
  const first={snapshot:before,manifest:prior,pdfBytes:pdf};
  const delta=compareSyntheticProposalRevisions(first,{snapshot:after,manifest:next,pdfBytes:pdf});
  assert.equal(delta.from,3);
  assert.equal(delta.to,4);
  assert.ok(delta.changes.some(x=>x.field==="Total" && x.before==="$1,020.00" && x.after==="$1,045.00"));
  assert.ok(delta.changes.some(x=>x.field==="Scope 1"));
  assert.ok(delta.changes.some(x=>x.field==="Service interior_repaint"));
  const html=renderSyntheticProposalReview(after,next,pdf,first);
  assert.match(html,/Changes since revision 3/);
  assert.match(html,/Prior revision receipts and QA evidence are stale/);
  assert.match(html,/\$1,045.00/);
  assert.match(html,/BLOCKED - SYNTHETIC INTERNAL DRAFT - NOT FOR DELIVERY/);
  assert.doesNotMatch(html,/<form\b|<button\b|<script\b/);

  const unchanged=renderSyntheticProposalReview(before,{...prior,revision:4},pdf,first);
  assert.match(unchanged,/No content differences. The new revision still invalidates prior signoff/);
});

test("Foreign, stale, skipped, swapped and tampered revisions are never compared",()=>{
  const a=fixtures[0], b=fixtures[1], prior={snapshot:a,manifest:evidence(a),pdfBytes:pdf};
  const revised={snapshot:a,manifest:{...evidence(a),revision:4},pdfBytes:pdf};
  assert.throws(()=>compareSyntheticProposalRevisions(prior,{
    ...revised,manifest:{...revised.manifest,revision:5}}),/Nonconsecutive/);
  assert.throws(()=>compareSyntheticProposalRevisions(prior,{
    snapshot:b,manifest:{...evidence(b),revision:4},pdfBytes:pdf}),/unrelated/);
  assert.throws(()=>compareSyntheticProposalRevisions({...prior,pdfBytes:Buffer.from("tampered")},
    revised),/mismatch/);
  assert.throws(()=>compareSyntheticProposalRevisions(prior,{...revised,manifest:{
    ...revised.manifest,snapshotSha256:"0".repeat(64)}}),/mismatch/);
  const duplicate=structuredClone(a);
  duplicate.proposal.lines.push({...duplicate.proposal.lines[0]});
  assert.throws(()=>compareSyntheticProposalRevisions(prior,{
    snapshot:duplicate,manifest:{...evidence(duplicate),revision:4},pdfBytes:pdf
  }),/Duplicate synthetic service code/);
});

test("Changed untrusted revision descriptions are escaped in the comparison report",()=>{
  const before=structuredClone(fixtures[0]), after=structuredClone(before);
  after.proposal.scope[0].work='<img src=x onerror="attack()">';
  const first={snapshot:before,manifest:evidence(before),pdfBytes:pdf};
  const html=renderSyntheticProposalReview(after,{...evidence(after),revision:4},pdf,first);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;attack()&quot;&gt;"));
  assert.doesNotMatch(html,/<img\b|<script\b|<form\b/);
});
