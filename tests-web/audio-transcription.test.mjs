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
    called=true;assert.equal(input,audio);assert.equal(format,"audio/wav");
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
