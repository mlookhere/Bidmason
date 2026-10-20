import type { ExtractionCorrectionChange } from "./extraction-correction-draft.ts";
import type { IntakeSource, ExtractionReview, ServiceCandidate } from "./intake-review.ts";

export type CorrectionEditorState = {
  evidenceKey: string;
  changes: ExtractionCorrectionChange[];
};
export type CorrectionEditorAction =
  | {type:"replace";index:number;serviceCode:string;units:number;reason:string}
  | {type:"remove";index:number;reason:string}
  | {type:"add";serviceCode:string;units:number;start:number;end:number;reason:string}
  | {type:"revert";index:number}
  | {type:"discard-add";serviceCode:string;start:number;end:number}
  | {type:"clear"};

const CODE=/^[a-z][a-z0-9_-]{0,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const SURROGATE=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/** A browser state key, NOT a signature. The server must revalidate the
 * immutable original and regenerate the correction digest before persistence. */
export function correctionEvidenceKey(review: ExtractionReview): string {
  if (!review || !SHA.test(review.sourceSha256)
    || !SHA.test(review.candidatesSha256)) {
    throw new TypeError("Invalid reviewed correction evidence key");
  }
  return review.sourceSha256+":"+review.candidatesSha256;
}
export function emptyCorrectionEditor(review: ExtractionReview): CorrectionEditorState {
  return {evidenceKey:correctionEvidenceKey(review),changes:[]};
}
function reasonText(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("A human explanation is required");
  const trimmed=value.trim();
  if (!trimmed || trimmed.length>500
    || new TextEncoder().encode(trimmed).length>1000
    || /[\u0000-\u001f\u007f]/u.test(trimmed) || SURROGATE.test(trimmed)) {
    throw new TypeError("A valid bounded human explanation is required");
  }
  return trimmed;
}
function service(code: unknown, units: unknown,
  start:number,end:number,text:string): ServiceCandidate {
  if(typeof code!=="string"||!CODE.test(code)
    || !Number.isSafeInteger(units)||(units as number)<1
    || !Number.isSafeInteger(start)||!Number.isSafeInteger(end)
    || start<0||end<=start||end>text.length){
    throw new TypeError("Valid source-backed service and quantity required");
  }
  const excerpt=text.slice(start,end);
  if(!excerpt.trim()||SURROGATE.test(excerpt)
    || (start>0 && /[\uDC00-\uDFFF]/u.test(text[start]))
    || (end<text.length && /[\uDC00-\uDFFF]/u.test(text[end]))){
    throw new TypeError("Select a complete, nonempty source passage");
  }
  return {serviceCode:code,units:units as number,start,end,excerpt};
}
function canonical(changes:ExtractionCorrectionChange[]):ExtractionCorrectionChange[] {
  const indexed=changes.filter(c=>c.action!=="add").sort((a,b)=>
    (a as {index:number}).index-(b as {index:number}).index);
  const additions=changes.filter(c=>c.action==="add").sort((a,b)=>{
    const x=(a as Extract<ExtractionCorrectionChange,{action:"add"}>).candidate;
    const y=(b as Extract<ExtractionCorrectionChange,{action:"add"}>).candidate;
    return x.start-y.start||x.end-y.end||x.serviceCode.localeCompare(y.serviceCode);
  });
  return [...indexed,...additions];
}
/** Local proposed edits, not authenticated persistence or approved scope. */
export function changeCorrectionEditor(
  original:IntakeSource,review:ExtractionReview,current:CorrectionEditorState,
  action:CorrectionEditorAction,
):CorrectionEditorState {
  if(typeof original?.text!=="string"
    || !Array.isArray(review?.candidates)||review.candidates.length===0
    || review.candidates.length>50){
    throw new TypeError("No source-backed extraction available to correct");
  }
  const key=correctionEvidenceKey(review);
  const prior=current?.evidenceKey===key?current.changes:[];
  if(action.type==="clear")return {evidenceKey:key,changes:[]};
  let next:ExtractionCorrectionChange[];
  if(action.type==="revert"){
    if(!Number.isSafeInteger(action.index)||action.index<0
      || action.index>=review.candidates.length)throw new TypeError("Invalid original service index");
    next=prior.filter(c=>c.action==="add"||c.index!==action.index);
  }else if(action.type==="discard-add"){
    next=prior.filter(c=>c.action!=="add"
      || c.candidate.serviceCode!==action.serviceCode
      || c.candidate.start!==action.start||c.candidate.end!==action.end);
  }else if(action.type==="replace"||action.type==="remove"){
    if(!Number.isSafeInteger(action.index)||action.index<0
      || action.index>=review.candidates.length)throw new TypeError("Invalid original service index");
    const before=review.candidates[action.index];
    const reason=reasonText(action.reason);
    const change:ExtractionCorrectionChange=action.type==="remove"
      ? {action:"remove",index:action.index,reason}
      : {action:"replace",index:action.index,
          candidate:service(action.serviceCode,action.units,before.start,before.end,original.text),
          reason};
    if(change.action==="replace" && JSON.stringify(change.candidate)===JSON.stringify(before)){
      throw new Error("Correction must change the extracted service");
    }
    next=[...prior.filter(c=>c.action==="add"||c.index!==action.index),change];
  }else if(action.type==="add"){
    const newCandidate=service(action.serviceCode,action.units,
      action.start,action.end,original.text);
    const reason=reasonText(action.reason);
    next=[...prior,{action:"add",candidate:newCandidate,reason}];
  }else{
    throw new TypeError("Unsupported correction editor action");
  }
  next=canonical(next);
  if(next.length>100)throw new Error("Too many proposed corrections");
  const indexed=new Map(next.filter(c=>c.action!=="add")
    .map(c=>[(c as {index:number}).index,c]));
  const projected=review.candidates.flatMap((candidate,index)=>{
    const edit=indexed.get(index);
    if(edit?.action==="remove")return [];
    return [edit?.action==="replace"?edit.candidate:candidate];
  }).concat(next.filter(c=>c.action==="add")
    .map(c=>(c as Extract<ExtractionCorrectionChange,{action:"add"}>).candidate));
  if(projected.length<1||projected.length>50
    || new Set(projected.map(c=>c.serviceCode)).size!==projected.length){
    throw new Error("Corrected scope must have one to 50 distinct services");
  }
  return {evidenceKey:key,changes:next};
}
export function prepareCorrectionEditorRequest(
  review:ExtractionReview,state:CorrectionEditorState,
):{sourceSha256:string;candidatesSha256:string;changes:ExtractionCorrectionChange[]} {
  if(!state||state.evidenceKey!==correctionEvidenceKey(review)
    || !Array.isArray(state.changes)||state.changes.length===0
    || state.changes.length>100){
    throw new Error("Correction editor is stale or has no proposed changes");
  }
  return {sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
    changes:state.changes.map(c=>c.action==="remove"
      ? {...c} : {...c,candidate:{...c.candidate}})};
}
