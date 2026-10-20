import test from "node:test";
import assert from "node:assert/strict";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {prepareExtractionCorrectionDraft} from "../lib/extraction-correction-draft.ts";
import {emptyCorrectionEditor,changeCorrectionEditor,prepareCorrectionEditorRequest}
 from "../lib/extraction-correction-editor.ts";

const original={kind:"typed-note",text:"Paint 2 rooms; clean 3 rooms; wash windows 🪟"};
const candidate=(serviceCode,units,excerpt)=>{
 const start=original.text.indexOf(excerpt);
 return {serviceCode,units,start,end:start+excerpt.length,excerpt};
};
const painted=candidate("paint",2,"Paint 2 rooms");
const cleaned=candidate("clean",2,"clean 3 rooms");
const reviewed=()=>prepareExtractionReview(original,[painted,cleaned]);
const replace={type:"replace",index:1,serviceCode:"clean",units:3,
 reason:"Customer verified quantity from original source"};
const add={type:"add",serviceCode:"windows",units:1,
 start:original.text.indexOf("wash windows"),
 end:original.text.indexOf("wash windows")+"wash windows".length,
 reason:"Missed exact-source requested work"};
const apply=(review,actions)=>{
 let state=emptyCorrectionEditor(review);
 for(const action of actions)state=changeCorrectionEditor(original,review,state,action);
 return state;
};
test("browser editor emits a server-compatible correction draft without approval",()=>{
 const review=reviewed(),before=structuredClone(review),state=apply(review,[replace,add]);
 const request=prepareCorrectionEditorRequest(review,state);
 const server=prepareExtractionCorrectionDraft(original,review,request.changes);
 assert.equal(server.state,"awaiting-authorized-extraction-correction");
 assert.equal(server.proposedCandidates[1].units,3);
 assert.equal(server.proposedCandidates[2].serviceCode,"windows");
 assert.deepEqual(review,before);
 assert.equal(Object.hasOwn(request,"approved"),false);
 assert.equal(Object.hasOwn(request,"actorId"),false);
 assert.equal(Object.hasOwn(request,"priceCents"),false);
 assert.deepEqual(request.changes.map(c=>c.action),["replace","add"]);
});
test("action order canonicalizes replacements, removals and additions",()=>{
 const review=reviewed();
 const removal={type:"remove",index:0,reason:"Customer confirmed no painting scope"};
 const fromAddFirst=apply(review,[add,removal,replace]);
 const fromOthers=apply(review,[replace,removal,add]);
 assert.deepEqual(fromAddFirst,fromOthers);
 const result=prepareExtractionCorrectionDraft(original,review,
  prepareCorrectionEditorRequest(review,fromOthers).changes);
 assert.deepEqual(result.proposedCandidates.map(x=>x.serviceCode),["clean","windows"]);
});
test("editing same original row supersedes prior correction; undo restores unchanged",()=>{
 const review=reviewed();
 let state=apply(review,[replace]);
 state=changeCorrectionEditor(original,review,state,{
  ...replace,units:4,reason:"Verified follow-up revised count"});
 assert.equal(state.changes.length,1);
 assert.equal(state.changes[0].candidate.units,4);
 state=changeCorrectionEditor(original,review,state,{type:"revert",index:1});
 assert.deepEqual(state.changes,[]);
 assert.throws(()=>prepareCorrectionEditorRequest(review,state),/no proposed changes/);
});
test("explicit omission needs unique service and exact highlighted source offset",()=>{
 const review=reviewed();
 const wrong=[
  {...add,serviceCode:"paint"},
  {...add,start:original.text.length,end:original.text.length+1},
  {...add,start:3,end:3},
  {...add,start:0,end:1,serviceCode:"not_valid!"},
  {...add,units:0},
  {...add,units:1.5},
  {...add,reason:" "},
  {...add,reason:"x".repeat(501)},
  {...add,reason:"x\nforged"},
 ];
 for(const action of wrong){
  assert.throws(()=>changeCorrectionEditor(original,review,emptyCorrectionEditor(review),action));
 }
});
test("duplicate omitted services and removing every original service are blocked",()=>{
 const review=reviewed();
 let s=apply(review,[add]);
 assert.throws(()=>changeCorrectionEditor(original,review,s,add),/distinct services/);
 s=changeCorrectionEditor(original,review,emptyCorrectionEditor(review),
  {type:"remove",index:0,reason:"Not requested"});
 assert.throws(()=>changeCorrectionEditor(original,review,s,
  {type:"remove",index:1,reason:"Not requested"}),/one to 50 distinct services/);
});
test("highlight cannot split a surrogate pair or select whitespace alone",()=>{
 const review=reviewed(),emoji=original.text.indexOf("🪟");
 for(const [start,end] of [[emoji,emoji+1],[emoji+1,emoji+2],
  [original.text.indexOf(";")+1,original.text.indexOf(";")+2]]){
  assert.throws(()=>changeCorrectionEditor(original,review,emptyCorrectionEditor(review),
   {...add,start,end}),/complete|passage/);
 }
 assert.equal(apply(review,[{...add,start:emoji,end:emoji+2}]).changes[0].candidate.excerpt,"🪟");
});
test("stale review evidence discards local edits and rejects old submission",()=>{
 const review=reviewed(),prior=apply(review,[replace]);
 const altered={...review,candidatesSha256:"a".repeat(64)};
 assert.throws(()=>prepareCorrectionEditorRequest(altered,prior),/stale/);
 const reset=changeCorrectionEditor(original,altered,prior,add);
 assert.deepEqual(reset.changes.map(c=>c.action),["add"]);
});
test("recorded edits remain detached when sending candidate arrays to caller",()=>{
 const review=reviewed(),state=apply(review,[replace,add]);
 const req=prepareCorrectionEditorRequest(review,state);
 req.changes[0].candidate.units=99;
 assert.equal(state.changes[0].candidate.units,3);
 const removed=changeCorrectionEditor(original,review,state,{
  type:"discard-add",serviceCode:"windows",start:add.start,end:add.end});
 assert.equal(removed.changes.length,1);
 assert.equal(removed.changes[0].action,"replace");
});
test("no-op and invalid original index fail before proposal creation",()=>{
 const review=reviewed();
 for(const action of [
  {type:"replace",index:0,serviceCode:"paint",units:2,reason:"No change"},
  {...replace,index:-1},
  {...replace,index:100},
  {type:"revert",index:99},
 ]){
  assert.throws(()=>changeCorrectionEditor(original,review,emptyCorrectionEditor(review),action));
 }
});
