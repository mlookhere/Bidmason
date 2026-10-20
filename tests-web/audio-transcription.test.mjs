import test from "node:test";
import assert from "node:assert/strict";
import {transcribeOriginalAudio} from "../lib/audio-transcription.ts";
import {prepareExtractionReview} from "../lib/intake-review.ts";

const audio=Buffer.concat([Buffer.from("RIFF"),Buffer.alloc(4),Buffer.from("WAVE"),Buffer.alloc(32)]);
const reply=(text="Paint fifteen rooms")=>({status:"ok",text,durationMs:2400,uncertainties:[],segments:[
  {start:0,end:text.length,excerpt:text,startMs:0,endMs:2400}]});
const provider=(fn=async()=>reply())=>({name:"isolated-test-transcriber",version:"v1",recognize:fn});

test("successful bounded transcription enters human review, not approval",async()=>{
  const out=await transcribeOriginalAudio(audio,"audio/wav",provider());
  assert.equal(out.state,"needs-human-review");
  assert.equal(out.original.transcriptionSucceeded,true);
  assert.match(out.audioSha256,/^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(out,"audio"),false);
  assert.equal(Object.hasOwn(out,"approved"),false);
  assert.equal(out.segments[0].excerpt,"Paint fifteen rooms");
  assert.equal(prepareExtractionReview(out.original,[{serviceCode:"paint",units:15,start:0,end:5,excerpt:"Paint"}]).state,"needs-human-review");
});
test("uncertain speech and ambiguous numbers block extraction",async()=>{
  const text="Paint fifteen rooms";
  const u={start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"};
  const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>({...reply(text),uncertainties:[u]})));
  assert.equal(out.state,"needs-information");
  assert.equal(out.uncertainties[0].reason,"ambiguous-number");
  assert.equal(out.original.transcriptionSucceeded,false);
  assert.throws(()=>prepareExtractionReview(out.original,[{serviceCode:"paint",units:15,start:0,end:5,excerpt:"Paint"}]),/transcription/);
});
test("unintelligible audio preserves only digest and failure status",async()=>{
  const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>({status:"unintelligible"})));
  assert.deepEqual(Object.keys(out).sort(),["audioSha256","reason","state"]);
  assert.equal(out.state,"failed");assert.equal(out.reason,"unintelligible");
});
test("unsupported content signatures or unbounded bytes never reach provider",async()=>{
  let calls=0;const p=provider(async()=>{calls++;return reply()});
  for(const [bytes,format] of [[Buffer.from("this is not real audio"),"audio/wav"],[audio,"audio/mpeg"],[Buffer.alloc(8*1024*1024+1),"audio/wav"],[audio,"text/plain"]])
    await assert.rejects(transcribeOriginalAudio(bytes,format,p),/audio|format/);
  assert.equal(calls,0);
});
test("provider exception and malformed reply fail closed without leaking details",async()=>{
  const problem=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>{throw Error("sensitive transcript provider key") }));
  assert.deepEqual({state:problem.state,reason:problem.reason},{state:"failed",reason:"provider-error"});
  for(const invalid of [null,{},"raw transcript",{...reply(),approved:true},
    {...reply(),uncertainties:undefined},{...reply(),text:"x".repeat(65537)},
    {...reply(),durationMs:600001},{...reply(),segments:[{...reply().segments[0],endMs:5000}]},
    {...reply(),uncertainties:[{start:0,end:5,excerpt:"wrong",reason:"ambiguous-number"}]}]){
    const o=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>invalid));
    assert.equal(o.state,"failed");assert.equal(o.reason,"invalid-response");
  }
});
test("provider receives exact bytes and source digest with a deadline signal",async()=>{
  let called=false;
  const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async({audio:input,format,sha256,signal})=>{
    called=true;assert.notStrictEqual(input,audio);
    assert.deepEqual(Buffer.from(input),audio);assert.equal(format,"audio/wav");
    assert.equal(signal.aborted,false);assert.match(sha256,/^[a-f0-9]{64}$/);return reply();
  }),1000);
  assert.equal(called,true);assert.equal(out.state,"needs-human-review");
});
test("provider that ignores cancellation still produces a failed timeout result",async()=>{
  const out=await transcribeOriginalAudio(audio,"audio/wav",provider(()=>new Promise(()=>{})),5);
  assert.equal(out.state,"failed");assert.equal(out.reason,"timeout");
});
test("untrusted provider metadata and malformed timestamps never assert success",async()=>{
  for(const v of [{...reply(),segments:[] ,totalCents:100},
    {...reply(),uncertainties:[{start:0,end:5,excerpt:"Paint",reason:"other",extra:"x"}]},
    {...reply(),segments:[{start:0,end:4,excerpt:"Pain",startMs:500,endMs:200}]}]){
    const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>v));
    assert.equal(out.state,"failed");
  }
});

test("successful transcript requires coherent ordered audio and text segment evidence",async()=>{
 const text="Paint two rooms";
 const spans=[
  {start:0,end:5,excerpt:"Paint",startMs:0,endMs:650},
  {start:6,end:9,excerpt:"two",startMs:700,endMs:1150},
  {start:10,end:15,excerpt:"rooms",startMs:1200,endMs:2400},
 ];
 const valid=await transcribeOriginalAudio(audio,"audio/wav",
   provider(async()=>({...reply(text),segments:spans})));
 assert.equal(valid.state,"needs-human-review");
 assert.deepEqual(valid.segments,spans);
 const invalid=[
  [],
  [spans[0],{...spans[1],start:4,end:9,excerpt:text.slice(4,9)}],
  [spans[1],spans[0]],
  [spans[0],{...spans[1],startMs:600}],
  [{...spans[0],endMs:2500}],
 ];
 for (const segments of invalid){
  const out=await transcribeOriginalAudio(audio,"audio/wav",
    provider(async()=>({...reply(text),segments})));
  assert.equal(out.state,"failed");
  assert.equal(out.reason,"invalid-response");
 }
});

test("overlapping provider uncertainties cannot create uncorrectable transcript",async()=>{
 const text="Paint fifteen rooms";
 const ambiguities=[
  {start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"},
  {start:7,end:14,excerpt:"ifteen ",reason:"unclear-speech"},
 ];
 const out=await transcribeOriginalAudio(audio,"audio/wav",
   provider(async()=>({...reply(text),uncertainties:ambiguities})));
 assert.equal(out.state,"failed");
 assert.equal(out.reason,"invalid-response");
 const independent=[
  {start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"},
  {start:14,end:19,excerpt:"rooms",reason:"other"},
 ];
 const needs=await transcribeOriginalAudio(audio,"audio/wav",
   provider(async()=>({...reply(text),uncertainties:[...independent].reverse()})));
 assert.equal(needs.state,"needs-information");
 assert.equal(needs.original.transcriptionSucceeded,false);
});

test("provider malformed Unicode and NUL cannot be labeled a completed transcript",async()=>{
 for (const text of ["Paint\u0000rooms","Paint\uD800rooms","Rooms\uDC00"]){
  const out=await transcribeOriginalAudio(audio,"audio/wav",
    provider(async()=>reply(text)));
  assert.equal(out.state,"failed");
  assert.equal(out.reason,"invalid-response");
 }
});

test("validated provider timestamps and clarifications are detached from mutable reply",async()=>{
 const original=reply();
 original.uncertainties=[{start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"}];
 const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>original));
 assert.equal(out.state,"needs-information");
 assert.equal(out.segments[0].start,0);
 assert.equal(out.uncertainties[0].reason,"ambiguous-number");
 original.segments[0].start=4;
 original.segments[0].excerpt="fake";
 original.uncertainties[0].reason="other";
 original.uncertainties.push({start:0,end:5,excerpt:"Paint",reason:"other"});
 assert.equal(out.segments[0].start,0);
 assert.equal(out.segments[0].excerpt,"Paint fifteen rooms");
 assert.equal(out.uncertainties[0].reason,"ambiguous-number");
 assert.equal(out.uncertainties.length,1);
});

test("provider must timestamp every substantive character, not merely one valid excerpt",async()=>{
 const text="Paint two rooms; charge $5.";
 const valid=[
  {start:0,end:5,excerpt:"Paint",startMs:0,endMs:300},
  {start:6,end:9,excerpt:"two",startMs:350,endMs:500},
  {start:10,end:15,excerpt:"rooms",startMs:550,endMs:800},
  {start:17,end:23,excerpt:"charge",startMs:850,endMs:1100},
  {start:24,end:26,excerpt:"$5",startMs:1150,endMs:1400},
 ];
 const success=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>({
  ...reply(text),segments:valid,
 })));
 assert.equal(success.state,"needs-human-review");
 for(const segments of [
  [valid[0]],
  [valid[0],valid[2],valid[3],valid[4]],
  [valid[0],valid[1],valid[2],valid[3]],
 ]) {
  const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>({
   ...reply(text),segments,
  })));
  assert.equal(out.state,"failed");
  assert.equal(out.reason,"invalid-response");
 }
});

test("caller-owned audio cannot be mutated by or switched beneath provider handoff",async()=>{
 const original=Buffer.from(audio),baseline=Buffer.from(original);
 const transcriber=provider(async({audio:received,sha256})=>{
  assert.notStrictEqual(received,original);
  assert.deepEqual(Buffer.from(received),baseline);
  original[0]=0;
  assert.deepEqual(Buffer.from(received),baseline);
  assert.match(sha256,/^[0-9a-f]{64}$/);
  return reply();
 });
 const out=await transcribeOriginalAudio(original,"audio/wav",transcriber);
 assert.equal(out.state,"needs-human-review");
 assert.equal(out.segments[0].excerpt,"Paint fifteen rooms");
 assert.notEqual(original[0],baseline[0]);
});

test("provider audio mutation and identity drift cannot silently change returned evidence",async()=>{
 const original=Buffer.from(audio),before=Buffer.from(original);
 const mutator=provider(async({audio:received})=>{
  received[0]=0;
  return reply();
 });
 const result=await transcribeOriginalAudio(original,"audio/wav",mutator);
 assert.equal(result.state,"failed");
 assert.equal(result.reason,"invalid-response");
 assert.deepEqual(original,before);
 const changing=provider(async()=>{changing.name="forged-name";changing.version="v999";return reply();});
 const stable=await transcribeOriginalAudio(Buffer.from(audio),"audio/wav",changing);
 assert.equal(stable.state,"needs-human-review");
 assert.equal(stable.providerName,"isolated-test-transcriber");
 assert.equal(stable.providerVersion,"v1");
});


test("untrusted provider accessor and decorated evidence fails without invoking getters",async()=>{
 let getters=0;
 const text="Paint fifteen rooms";
 const base=()=>({...reply(text),
  uncertainties:[{start:6,end:13,excerpt:"fifteen",reason:"ambiguous-number"}]});
 const bad=[
  ()=>Object.defineProperty(base(),"status",{enumerable:true,
    get(){getters++;throw Error("unsafe status getter");}}),
  ()=>Object.defineProperty(base(),"text",{enumerable:true,
    get(){getters++;throw Error("unsafe text getter");}}),
  ()=>Object.defineProperty(base(),"hidden",{value:"approved"}),
  ()=>{const r=base();r[Symbol("send")]=true;return r;},
  ()=>Object.setPrototypeOf(base(),{approved:true}),
  ()=>Object.defineProperty({status:"unintelligible"},"status",{enumerable:true,
    get(){getters++;throw Error("unsafe unintelligible getter");}}),
  ()=>Object.defineProperty({status:"unintelligible"},"hidden",{value:1}),
  ()=>{const r=base();Object.defineProperty(r.segments,"0",{enumerable:true,
    get(){getters++;throw Error("unsafe segment index");}});return r;},
  ()=>{const r=base();delete r.segments[0];return r;},
  ()=>{const r=base();r.segments[Symbol("approved")]=true;return r;},
  ()=>{const r=base();Object.setPrototypeOf(r.segments,
    Object.create(Array.prototype));return r;},
  ()=>{const r=base();Object.defineProperty(r.segments[0],"start",{enumerable:true,
    get(){getters++;throw Error("unsafe timestamp getter");}});return r;},
  ()=>{const r=base();Object.defineProperty(r.segments[0],"hidden",{value:1});return r;},
  ()=>{const r=base();Object.defineProperty(r.uncertainties,"0",{enumerable:true,
    get(){getters++;throw Error("unsafe uncertainty index");}});return r;},
  ()=>{const r=base();delete r.uncertainties[0];return r;},
  ()=>{const r=base();r.uncertainties[0][Symbol("send")]=true;return r;},
  ()=>{const r=base();Object.defineProperty(r.uncertainties[0],"reason",{
    enumerable:true,get(){getters++;throw Error("unsafe uncertainty reason");}
   });return r;},
 ];
 for(const construct of bad){
  const result=await transcribeOriginalAudio(audio,"audio/wav",
    provider(async()=>construct()));
  assert.equal(result.state,"failed");
  assert.equal(result.reason,"invalid-response");
  assert.equal(Object.hasOwn(result,"original"),false);
  assert.equal(Object.hasOwn(result,"segments"),false);
 }
 assert.equal(getters,0);
});

test("canonical provider reply with null-prototype plain data remains review-only",async()=>{
 const result=Object.assign(Object.create(null),reply());
 result.segments=result.segments.map(s=>Object.assign(Object.create(null),s));
 result.uncertainties=[];
 const out=await transcribeOriginalAudio(audio,"audio/wav",provider(async()=>result));
 assert.equal(out.state,"needs-human-review");
 assert.equal(out.original.transcriptionSucceeded,true);
 assert.equal(out.segments[0].excerpt,"Paint fifteen rooms");
 assert.equal(Object.getPrototypeOf(out.segments[0]),Object.prototype);
});
