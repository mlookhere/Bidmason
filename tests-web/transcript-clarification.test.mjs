import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {listTranscriptClarifications,prepareTranscriptCorrectionDraft}
  from "../lib/transcript-clarification.ts";

const source="Paint fifteen units, install forty fixtures.";
function blocked(text=source, uncertainties=[
  {start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"},
  {start:29,end:34,excerpt:"forty",reason:"unclear-speech"},
]){
 return {state:"needs-information",audioSha256:"a".repeat(64),
  providerName:"synthetic-transcriber",providerVersion:"v1",durationMs:4000,
  original:{kind:"transcript",text,transcriptionSucceeded:false},
  uncertainties,segments:[]};
}
const changes=[
  {uncertaintyIndex:0,replacement:"15",explanation:"Listened and confirmed number"},
  {uncertaintyIndex:1,replacement:"40",explanation:"Verified from recorded walkthrough"},
];

test("unclear number prompts preserve the exact original source references",()=>{
  assert.deepEqual(listTranscriptClarifications(blocked()),[
    {uncertaintyIndex:0,reason:"ambiguous-number",originalExcerpt:"fifteen",start:6,end:13},
    {uncertaintyIndex:1,reason:"unclear-speech",originalExcerpt:"forty",start:29,end:34},
  ]);
});
test("all explicit corrections create source-bound, non-activating revision draft",()=>{
  const original=blocked();
  const before=structuredClone(original);
  const draft=prepareTranscriptCorrectionDraft(original,changes);
  assert.equal(draft.state,"awaiting-authorized-correction");
  assert.equal(draft.proposedSource.text,"Paint 15 units, install 40 fixtures.");
  assert.equal(draft.proposedSource.transcriptionSucceeded,false);
  assert.deepEqual(draft.corrections.map(x=>[x.originalStart,x.originalEnd,
    x.correctedStart,x.correctedEnd]),[[6,13,6,8],[29,34,24,26]]);
  assert.match(draft.correctionSha256,/^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(draft,"approved"),false);
  assert.deepEqual(original,before);
  assert.throws(()=>prepareExtractionReview(draft.proposedSource,[
    {serviceCode:"paint",units:15,start:0,end:5,excerpt:"Paint"}]),/transcription/);
});
test("decision ordering does not affect deterministic corrected text or fingerprints",()=>{
 const a=prepareTranscriptCorrectionDraft(blocked(),changes);
 const b=prepareTranscriptCorrectionDraft(blocked(),[changes[1],changes[0]]);
 assert.deepEqual(a,b);
});
test("each uncertainty must receive exactly one explicit correction",()=>{
 for(const decisions of [[],[changes[0]],[
  changes[0],changes[0]],[
  changes[0],{...changes[1],uncertaintyIndex:99}]]) {
  assert.throws(()=>prepareTranscriptCorrectionDraft(blocked(),decisions),
    /Every ambiguous|Invalid or duplicate|Missing/);
 }
});
test("forged approval directives or missing explanation are rejected",()=>{
 const invalid=[
  {...changes[0],approved:true},
  {...changes[0],send:true},
  {...changes[0],replacement:" "},
  {...changes[0],explanation:" "},
  {...changes[0],replacement:"x".repeat(513)},
  {...changes[0],replacement:"\u0000"},
  {...changes[0],uncertaintyIndex:1},
 ];
 for(const first of invalid) {
  assert.throws(()=>prepareTranscriptCorrectionDraft(blocked(),[first,changes[1]]));
 }
});
test("overlaps or source-mismatched uncertainties fail closed",()=>{
 const bad=[
  [{start:0,end:5,excerpt:"wrong",reason:"unclear-speech"}],
  [{start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"},
   {start:10,end:18,excerpt:source.slice(10,18),reason:"other"}],
  [{start:900,end:950,excerpt:"offscreen",reason:"other"}],
 ];
 for(const uncertainties of bad) {
  assert.throws(()=>listTranscriptClarifications(blocked(source,uncertainties)),
    /span is invalid|overlapping/);
 }
});
test("provider-success, failed and forged transcription states cannot enter correction flow",()=>{
 const b=blocked();
 for(const state of [
  {...b,state:"needs-human-review",original:{...b.original,transcriptionSucceeded:true}},
  {state:"failed",audioSha256:b.audioSha256,reason:"unintelligible"},
  {...b,original:{...b.original,transcriptionSucceeded:true}},
  {...b,audioSha256:"bad"},
  {...b,uncertainties:[]},
  {...b,original:{...b.original,text:"x".repeat(65537)}},
 ]) assert.throws(()=>prepareTranscriptCorrectionDraft(state,changes),/Only a bounded/);
});
test("unrelated source text and correction explanations remain different auditable data",()=>{
 const a=prepareTranscriptCorrectionDraft(blocked(),changes);
 const b=prepareTranscriptCorrectionDraft(blocked(),[
  {...changes[0],explanation:"Confirmed from job sketch"},changes[1]]);
 assert.equal(a.proposedTranscriptSha256,b.proposedTranscriptSha256);
 assert.notEqual(a.correctionSha256,b.correctionSha256);
 assert.notEqual(a.rawTranscriptSha256,a.proposedTranscriptSha256);
 assert.equal(a.providerName,"synthetic-transcriber");
});
test("corrected transcript cannot exceed the source text limit",()=>{
 const text="a".repeat(65530)+"?";
 const blockedLong=blocked(text,[{start:65530,end:65531,excerpt:"?",reason:"other"}]);
 assert.throws(()=>prepareTranscriptCorrectionDraft(blockedLong,[{
  uncertaintyIndex:0,replacement:"additional text",explanation:"Checked"}]),
  /unbounded/);
});
