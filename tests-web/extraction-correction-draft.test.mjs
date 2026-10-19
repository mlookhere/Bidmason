import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview, previewReviewedQuote }
  from "../lib/intake-review.ts";
import { prepareExtractionCorrectionDraft }
  from "../lib/extraction-correction-draft.ts";

const source = {kind:"typed-note",text:"Paint 2 rooms; clean 3 rooms; wash windows"};
const item=(serviceCode,units,excerpt)=>{
 const start=source.text.indexOf(excerpt);
 return {serviceCode,units,start,end:start+excerpt.length,excerpt};
};
const painting=item("paint",2,"Paint 2 rooms");
const mistaken=item("clean",2,"clean 3 rooms");
const omitted=item("windows",1,"wash windows");
const review=()=>prepareExtractionReview(source,[painting,mistaken]);
const fix={action:"replace",index:1,candidate:{...mistaken,units:3},
 reason:"Operator confirmed quantity from source notes"};
const add={action:"add",candidate:omitted,
 reason:"Operator identified omitted exact-source work"};
const policy={policyId:"synthetic-crew",currency:"USD",
 minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
 services:{
  paint:{label:"Paint",unit:"room",rateCents:4000,billing:"charged"},
  clean:{label:"Clean",unit:"room",rateCents:3000,billing:"charged"},
  windows:{label:"Windows",unit:"job",rateCents:1000,billing:"charged"},
 }};

test("human corrections preserve provider evidence and remain nonactivating",()=>{
 const original=review(),before=structuredClone(original);
 const draft=prepareExtractionCorrectionDraft(source,original,[fix,add]);
 assert.equal(draft.state,"awaiting-authorized-extraction-correction");
 assert.deepEqual(original,before);
 assert.equal(draft.originalCandidatesSha256,original.candidatesSha256);
 assert.equal(draft.proposedCandidates[1].units,3);
 assert.equal(draft.proposedCandidates[2].serviceCode,"windows");
 assert.deepEqual(draft.changes.map(x=>x.action),["replace","add"]);
 assert.equal(draft.changes[0].before.units,2);
 assert.equal(draft.changes[0].after.units,3);
 assert.equal(draft.changes[0].reason,fix.reason);
 assert.match(draft.correctionSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(draft.proposedCandidatesSha256,original.candidatesSha256);
 assert.equal(Object.hasOwn(draft,"review"),false);
 assert.equal(Object.hasOwn(draft,"approved"),false);
 assert.equal(Object.hasOwn(draft,"send"),false);
 // The original persisted review remains unchanged: pricing it uses original units.
 assert.equal(previewReviewedQuote(source,original,[1],policy).quote.totalCents,6000);
});

test("operation order produces deterministic audit, quantities and SHA",()=>{
 const first=prepareExtractionCorrectionDraft(source,review(),[fix,add]);
 const second=prepareExtractionCorrectionDraft(source,review(),[add,fix]);
 assert.deepEqual(first,second);
});

test("source change and tampered provider extraction cannot be corrected",()=>{
 const original=review();
 assert.throws(()=>prepareExtractionCorrectionDraft(
  {...source,text:source.text+"."},original,[fix]),/immutable original/);
 original.candidates[0].units=99;
 assert.throws(()=>prepareExtractionCorrectionDraft(source,original,[fix]),
  /snapshot was modified/);
});

test("removal is audited and no-candidate correction is blocked",()=>{
 const removal={action:"remove",index:1,reason:"Confirmed this is not contracted scope"};
 const draft=prepareExtractionCorrectionDraft(source,review(),[removal]);
 assert.deepEqual(draft.proposedCandidates,[painting]);
 assert.equal(draft.changes[0].before.serviceCode,"clean");
 assert.equal(Object.hasOwn(draft.changes[0],"after"),false);
 assert.throws(()=>prepareExtractionCorrectionDraft(source,review(),[
  removal,{action:"remove",index:0,reason:"Wrong scope"},
 ]),/one to 50 distinct services/);
});

test("correction refuses unsupported prices, approvals, fabricated sources and duplicates",()=>{
 const wrong=[
  {...fix,approved:true},
  {...fix,actorId:"forged"},
  {...fix,priceCents:1},
  {...fix,reason:" "},
  {...fix,reason:"x".repeat(501)},
  {...fix,index:99},
  {...fix,candidate:{...fix.candidate,send:true}},
  {...fix,candidate:{...fix.candidate,excerpt:"invented"}},
  {action:"add",candidate:{...omitted,serviceCode:"paint"},reason:"Duplicate"},
 ];
 for(const change of wrong)assert.throws(()=>prepareExtractionCorrectionDraft(
  source,review(),[change]));
 assert.throws(()=>prepareExtractionCorrectionDraft(source,review(),[fix,fix]),
  /duplicate extraction correction index/);
 assert.throws(()=>prepareExtractionCorrectionDraft(source,review(),[
  {action:"replace",index:1,candidate:mistaken,reason:"No real change"},
 ]),/must change/);
});

test("hidden fields, symbol directives, getter actions and sparse requests fail closed",()=>{
 let invoked=0;
 const accessor={...fix};
 Object.defineProperty(accessor,"candidate",{enumerable:true,get(){invoked++;return fix.candidate;}});
 const hidden={...fix};
 Object.defineProperty(hidden,"send",{value:true});
 const symbolic={...fix,[Symbol("send")]:true};
 const inherited=Object.assign(Object.create({approved:true}),fix);
 for(const malformed of [accessor,hidden,symbolic,inherited]){
  assert.throws(()=>prepareExtractionCorrectionDraft(source,review(),[malformed]),
    /Invalid extraction correction action/);
 }
 assert.equal(invoked,0);
 const sparse=new Array(2);sparse[0]=fix;
 const augmented=[fix];Object.defineProperty(augmented,"send",{value:true});
 for(const list of [sparse,augmented]){
  assert.throws(()=>prepareExtractionCorrectionDraft(source,review(),list),
    /canonical extraction corrections/);
 }
});
