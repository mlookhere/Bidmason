"use client";

import {useState} from "react";
import type {IntakeSource,ExtractionReview} from "../lib/intake-review.ts";
import {correctionEvidenceKey,emptyCorrectionEditor,changeCorrectionEditor,
  prepareCorrectionEditorRequest,type CorrectionEditorAction}
  from "../lib/extraction-correction-editor.ts";

type CorrectionRequest=ReturnType<typeof prepareCorrectionEditorRequest>;
type RowDraft={serviceCode:string;units:string;reason:string};
type Props={
  original:IntakeSource;
  review:ExtractionReview;
  /** Supplied only by a trusted internal integration; never a publish/send. */
  onRequestCorrection?:(request:CorrectionRequest)=>void|Promise<void>;
};

function Editor({original,review,onRequestCorrection}:Props){
  const [state,setState]=useState(()=>emptyCorrectionEditor(review));
  const [rows,setRows]=useState<Record<number,RowDraft>>({});
  const [addition,setAddition]=useState<RowDraft>({
    serviceCode:"",units:"1",reason:"",
  });
  const [span,setSpan]=useState({start:0,end:0});
  const [error,setError]=useState<string|null>(null);
  const [submitted,setSubmitted]=useState(false);
  const [pending,setPending]=useState(false);
  const key=correctionEvidenceKey(review);
  const current=state.evidenceKey===key?state:emptyCorrectionEditor(review);
  const excerpt=original.text.slice(span.start,span.end);

  const field=(index:number,patch:Partial<RowDraft>)=>{
    const before=review.candidates[index];
    setRows(previous=>({...previous,[index]:{
      ...(previous[index]??{serviceCode:before.serviceCode,
        units:String(before.units),reason:""}),...patch,
    }}));
  };
  const unit=(text:string)=>/^[1-9][0-9]*$/.test(text)?Number(text):NaN;
  const queue=(action:CorrectionEditorAction)=>{
    try{
      setState(changeCorrectionEditor(original,review,current,action));
      setError(null);
      setSubmitted(false);
    }catch{
      setError("Correction is invalid. Check the selected evidence, service, quantity and explanation.");
    }
  };
  const submit=async()=>{
    if(!onRequestCorrection||pending)return;
    setPending(true);setSubmitted(false);setError(null);
    try{
      const request=prepareCorrectionEditorRequest(review,current);
      await onRequestCorrection(request);
      // An internal callback completing is never evidence of durable approval.
      setSubmitted(true);
    }catch{
      setError("Internal correction request was not confirmed. Refresh before retrying.");
    }finally{
      setPending(false);
    }
  };

  return <section aria-label="Internal extraction correction editor">
    <h2>Correct extracted services</h2>
    <p role="status">Draft changes only. No scope, price, or proposal is approved or sent here.</p>
    <p>Highlight an exact passage to add missed work. Original extraction evidence is retained.</p>
    <label>
      Original source — select a passage for an omitted service
      <textarea readOnly rows={4} value={original.text}
        onSelect={event=>setSpan({
          start:event.currentTarget.selectionStart,
          end:event.currentTarget.selectionEnd,
        })}/>
    </label>
    <p>Selected source passage: <q>{excerpt||"None selected"}</q></p>
    <fieldset>
      <legend>Corrections to extracted candidates</legend>
      {review.candidates.map((candidate,index)=>{
        const draft=rows[index]??{serviceCode:candidate.serviceCode,
          units:String(candidate.units),reason:""};
        const queued=current.changes.find(x=>x.action!=="add"&&x.index===index);
        return <div key={index}>
          <h3>Extracted {index+1}: {candidate.serviceCode} — {candidate.units} unit(s)</h3>
          <p>Exact evidence: <q>{candidate.excerpt}</q></p>
          <label>
            Corrected service code
            <input value={draft.serviceCode}
              onChange={e=>field(index,{serviceCode:e.target.value})}/>
          </label>
          <label>
            Corrected units
            <input inputMode="numeric" value={draft.units}
              onChange={e=>field(index,{units:e.target.value})}/>
          </label>
          <label>
            Explanation (required for change or removal)
            <textarea rows={2} maxLength={500} value={draft.reason}
              onChange={e=>field(index,{reason:e.target.value})}/>
          </label>
          <button type="button" onClick={()=>queue({type:"replace",index,
            serviceCode:draft.serviceCode,units:unit(draft.units),reason:draft.reason})}>
            Propose service correction
          </button>
          <button type="button" onClick={()=>queue({type:"remove",index,
            reason:draft.reason})}>
            Propose removal
          </button>
          {queued&&<button type="button" onClick={()=>queue({type:"revert",index})}>
            Discard proposed change
          </button>}
          {queued&&<p role="status">Draft {queued.action} recorded; not approved.</p>}
        </div>;
      })}
    </fieldset>
    <fieldset>
      <legend>Add omitted source-backed work</legend>
      <label>
        Missing service code
        <input value={addition.serviceCode}
          onChange={e=>setAddition(v=>({...v,serviceCode:e.target.value}))}/>
      </label>
      <label>
        Units
        <input inputMode="numeric" value={addition.units}
          onChange={e=>setAddition(v=>({...v,units:e.target.value}))}/>
      </label>
      <label>
        Explanation for missed item
        <textarea rows={2} maxLength={500} value={addition.reason}
          onChange={e=>setAddition(v=>({...v,reason:e.target.value}))}/>
      </label>
      <button type="button" disabled={span.end<=span.start}
        onClick={()=>queue({type:"add",serviceCode:addition.serviceCode,
          units:unit(addition.units),start:span.start,end:span.end,
          reason:addition.reason})}>
        Propose missing service from highlight
      </button>
    </fieldset>
    <h3>Uncommitted changes ({current.changes.length})</h3>
    <ul>{current.changes.map((change,index)=><li key={index}>
      {change.action==="add"
        ? "Add "+change.candidate.serviceCode+" from "+change.candidate.excerpt
        : change.action==="remove"
        ? "Remove extracted item "+(change.index+1)
        : "Correct item "+(change.index+1)+" to "+change.candidate.serviceCode+
          " ("+change.candidate.units+" units)"}
      {" — "+change.reason}
      {change.action==="add"&&<button type="button"
        onClick={()=>queue({type:"discard-add",serviceCode:change.candidate.serviceCode,
          start:change.candidate.start,end:change.candidate.end})}>
        Discard addition
      </button>}
    </li>)}</ul>
    <button type="button" disabled={!current.changes.length}
      onClick={()=>queue({type:"clear"})}>Clear draft changes</button>
    <button type="button"
      disabled={!onRequestCorrection||!current.changes.length||pending}
      onClick={submit}>
      {pending?"Requesting internal review…":"Request authorized correction review"}
    </button>
    {!onRequestCorrection&&<p>Authorized correction integration is not enabled.</p>}
    {error&&<p role="alert">{error}</p>}
    {submitted&&<p role="status">
      Internal handler completed. Changes still require independent authorization,
      persistence, activation and renewed human scope review.
    </p>}
  </section>;
}
/** Local client editor only. Not exposed through a public route. The key
 * remounts the form whenever immutable source/review evidence changes. */
export function ExtractionCorrectionPanel(props:Props){
  return <Editor key={correctionEvidenceKey(props.review)} {...props}/>;
}
