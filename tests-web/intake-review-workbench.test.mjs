import test from "node:test";
import assert from "node:assert/strict";
import { prepareExtractionReview } from "../lib/intake-review.ts";
import { buildReviewWorkbench, changeReviewSelection,
  emptyReviewSelection, prepareReviewPreviewRequest }
  from "../lib/intake-review-workbench.ts";

const original = {kind:"typed-note",text:"Clean 2 rooms; polish floor; quarterly care; add windows"};
const candidates = [
  {serviceCode:"clean",units:2,start:0,end:13,excerpt:"Clean 2 rooms"},
  {serviceCode:"floor",units:1,start:15,end:27,excerpt:"polish floor"},
  {serviceCode:"quarterly",units:1,start:29,end:43,excerpt:"quarterly care"},
  {serviceCode:"windows",units:1,start:45,end:56,excerpt:"add windows"},
];
const policy = {
 revision:2,
 pricing:{policyId:"office-clean-v2",currency:"USD",
   minimum:{rule:"none",cents:0},calculationOrder:"discount-then-surcharge",
   services:{
     clean:{label:"Office clean",unit:"room",rateCents:7000,billing:"charged"},
     floor:{label:"Floor polish",unit:"job",rateCents:3000,billing:"charged",optionalAddon:true},
     quarterly:{label:"Quarterly care",unit:"visit",rateCents:9000,billing:"pending"},
     windows:{label:"Window care",unit:"window",rateCents:1500,billing:"charged"},
   }},
 tax:{method:"none",bps:0},excludedServiceCodes:["windows"],
};
const build=()=>buildReviewWorkbench(original,prepareExtractionReview(original,candidates),policy);

test("review panel model distinguishes available, optional, pending and excluded",()=>{
 const model=build();
 assert.equal(model.state,"internal-review-only");
 assert.deepEqual(model.rows.map(r=>r.status),["available","optional","pending","excluded"]);
 assert.match(model.key,/^[a-f0-9]{64}$/);
 assert.equal(model.rows[0].excerpt,"Clean 2 rooms");
});

test("unsupported model codes are never selectable",()=>{
 const extended={...original,text:original.text+"; repair roof"};
 const review=prepareExtractionReview(extended,[...candidates,
   {serviceCode:"roof",units:1,start:58,end:69,excerpt:"repair roof"}]);
 const model=buildReviewWorkbench(extended,review,policy);
 assert.equal(model.rows[4].status,"unlisted");
 assert.throws(()=>changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"select",index:4,checked:true}),/not eligible/);
});

test("preview requires selections and separately acknowledged optional add-ons",()=>{
 const model=build();
 let current=emptyReviewSelection(model.key);
 assert.throws(()=>prepareReviewPreviewRequest(model,current),/incomplete/);
 current=changeReviewSelection(model,current,{type:"select",index:0,checked:true});
 current=changeReviewSelection(model,current,{type:"select",index:1,checked:true});
 assert.throws(()=>prepareReviewPreviewRequest(model,current),/acknowledgement/);
 current=changeReviewSelection(model,current,{type:"acknowledge-addon",
   serviceCode:"floor",checked:true});
 const request=prepareReviewPreviewRequest(model,current);
 assert.deepEqual(request.selectedIndices,[0,1]);
 assert.deepEqual(request.acceptedAddonCodes,["floor"]);
 assert.equal(request.reviewKey,model.key);
 assert.equal(Object.hasOwn(request,"send"),false);
});

test("unselecting an add-on also removes its separate acknowledgement",()=>{
 const model=build();
 let selected=changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"select",index:1,checked:true});
 selected=changeReviewSelection(model,selected,
   {type:"acknowledge-addon",serviceCode:"floor",checked:true});
 selected=changeReviewSelection(model,selected,
   {type:"select",index:1,checked:false});
 assert.deepEqual(selected.acceptedAddonCodes,[]);
 assert.deepEqual(selected.selectedIndices,[]);
});

test("pending or explicitly excluded work cannot be selected",()=>{
 const model=build();
 for(const index of [2,3]) assert.throws(()=>changeReviewSelection(
   model,emptyReviewSelection(model.key),{type:"select",index,checked:true}),
 /not eligible/);
 assert.throws(()=>changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"acknowledge-addon",serviceCode:"floor",checked:true}),/Unselected/);
});

test("new source and company revisions invalidate old selections",()=>{
 const old=build();
 const selection=changeReviewSelection(old,emptyReviewSelection(old.key),
   {type:"select",index:0,checked:true});
 const updated=buildReviewWorkbench(original,prepareExtractionReview(original,candidates),
   {...policy,revision:3});
 assert.notEqual(old.key,updated.key);
 assert.throws(()=>prepareReviewPreviewRequest(updated,selection),/stale/);
 const safe=changeReviewSelection(updated,selection,{type:"select",index:0,checked:true});
 assert.deepEqual(safe.selectedIndices,[0]);
 assert.equal(safe.key,updated.key);
 const changed={...original,text:original.text+"!"};
 const model2=buildReviewWorkbench(changed,prepareExtractionReview(changed,candidates),policy);
 assert.notEqual(model2.key,old.key);
});

test("forged candidate offsets or source edits invalidate the entire review",()=>{
 const review=prepareExtractionReview(original,candidates);
 assert.throws(()=>buildReviewWorkbench({...original,text:original.text+"!"},
   review,policy),/immutable original/);
 review.candidates[0].units=8;
 assert.throws(()=>buildReviewWorkbench(original,review,policy),/snapshot was modified/);
});

test("forged duplicate selections or acknowledgements do not become a preview",()=>{
 const model=build();
 const base=changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"select",index:0,checked:true});
 assert.throws(()=>prepareReviewPreviewRequest(model,
   {...base,selectedIndices:[0,0]}),/stale or incomplete/);
 assert.throws(()=>prepareReviewPreviewRequest(model,
   {...base,acceptedAddonCodes:["floor"]}),/Unselected/);
 assert.throws(()=>prepareReviewPreviewRequest(model,
   {...base,selectedIndices:[2]}),/ineligible/);
});

test("duplicate service candidates cannot be submitted as two charged lines",()=>{
 const review=prepareExtractionReview(original,[candidates[0],{...candidates[0]}]);
 const model=buildReviewWorkbench(original,review,policy);
 let state=emptyReviewSelection(model.key);
 state=changeReviewSelection(model,state,{type:"select",index:0,checked:true});
 state=changeReviewSelection(model,state,{type:"select",index:1,checked:true});
 assert.throws(()=>prepareReviewPreviewRequest(model,state),/Duplicate/);
});

test("invalid policy fields and unknown exclusions are rejected fail-closed",()=>{
 const review=prepareExtractionReview(original,candidates);
 assert.throws(()=>buildReviewWorkbench(original,review,{
   ...policy,excludedServiceCodes:["nonexistent"]}),/exclusions are invalid/);
 assert.throws(()=>buildReviewWorkbench(original,review,{
   ...policy,pricing:{...policy.pricing,services:null}}),/pricing policy/);
});

test("reset always removes selected and optional-acknowledged services",()=>{
 const model=build();
 let state=changeReviewSelection(model,emptyReviewSelection(model.key),
   {type:"select",index:1,checked:true});
 state=changeReviewSelection(model,state,
   {type:"acknowledge-addon",serviceCode:"floor",checked:true});
 state=changeReviewSelection(model,state,{type:"reset"});
 assert.deepEqual(state,emptyReviewSelection(model.key));
});

test("review rows cannot be selected when deterministic company economics fail",()=>{
 const review=prepareExtractionReview(original,candidates);
 const invalidPolicies=[
   // Missing a declared unit cost is not equivalent to zero cost.
   {...policy,unitDirectCostsCents:{floor:1000,quarterly:1000,windows:1000}},
   // Even syntactically valid rates may overflow safe integer totals.
   {...policy,pricing:{...policy.pricing,services:{...policy.pricing.services,
     clean:{...policy.pricing.services.clean,rateCents:Number.MAX_SAFE_INTEGER}}}},
   {...policy,pricing:{...policy.pricing,services:{...policy.pricing.services,
     clean:{...policy.pricing.services.clean,surchargeBps:10001}}}},
   {...policy,tax:{method:"exclusive-all-charged",bps:10001}},
 ];
 for(const candidate of invalidPolicies){
   const model=buildReviewWorkbench(original,review,candidate);
   assert.equal(model.rows[0].status,"invalid");
   assert.match(model.rows[0].explanation,/require correction/);
   assert.throws(()=>changeReviewSelection(model,emptyReviewSelection(model.key),
     {type:"select",index:0,checked:true}),/not eligible/);
 }
 // An unknown cost basis is not falsely reported as a validated margin,
 // but remains previewable when no partial cost schedule is asserted.
 const valid=buildReviewWorkbench(original,review,policy);
 assert.equal(valid.rows[0].status,"available");
 const partial=buildReviewWorkbench(original,review,{
   ...policy,unitDirectCostsCents:{clean:2000},
 });
 assert.equal(partial.rows[0].status,"available");
 assert.equal(partial.rows[1].status,"invalid");
 assert.throws(()=>changeReviewSelection(partial,emptyReviewSelection(partial.key),
   {type:"select",index:1,checked:true}),/not eligible/);
});
