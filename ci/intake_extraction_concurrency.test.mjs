/**
 * STAGING ONLY: real multi-process PostgreSQL concurrency regression.
 * Runs exclusively on the disposable 'intake-db' Actions PostgreSQL service.
 * The synthetic actor and service role are NOT production authentication.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {spawn,execFileSync} from "node:child_process";
import {prepareExtractionReview} from "../lib/intake-review.ts";

const ORG="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const text="Paint 🧱 two rooms, and clean entryway.";
const originalSha=createHash("sha256").update(text,"utf8").digest("hex");
const source={kind:"typed-note",text};
function candidate(code,excerpt,units=1) {
  const start=text.indexOf(excerpt);
  assert.ok(start>=0);
  return {serviceCode:code,units,start,end:start+excerpt.length,excerpt};
}
const first=prepareExtractionReview(source,[candidate("painting","🧱 two rooms",2)]);
const second=prepareExtractionReview(source,[candidate("cleaning","clean entryway",1)]);

function sql(script,vars={}) {
  const argv=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [key,value] of Object.entries(vars)) {
    if(!/^p[1-9]$/.test(key)||typeof value!=="string")
      throw Error("Invalid synthetic SQL test parameter");
    argv.push("-v",key+"="+value);
  }
  argv.push("-f","-");
  return execFileSync("psql",argv,{input:script,encoding:"utf8",timeout:10000}).trim();
}
function fixture() {
  const actor=randomUUID(),requestId=randomUUID();
  sql(`INSERT INTO public.bm_memberships(organization_id,user_id,member_role)
      VALUES (:'p1'::uuid,:'p2'::uuid,'operator');`,
    {p1:ORG,p2:actor});
  const sourceId=sql(`SET ROLE service_role;
    SELECT source_id FROM bm_intake_private.create_typed_note(
    :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:ORG,p2:actor,p3:requestId,p4:text});
  assert.match(sourceId,/^[0-9a-f-]{36}$/);
  function inspect() {
    return JSON.parse(sql(`SELECT row_to_json(t) FROM (
      SELECT id,revision,review,extraction_audit,scope_review,
        original_text,text_sha256
      FROM public.bm_intake_sources WHERE organization_id=:'p1'::uuid
      AND id=:'p2'::uuid) t;`,{p1:ORG,p2:sourceId}));
  }
  return {actor,sourceId,inspect};
}
async function cas(f,review) {
  const vars={p1:ORG,p2:f.actor,p3:f.sourceId,p4:originalSha,
    p5:JSON.stringify(review)};
  const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [key,value] of Object.entries(vars))args.push("-v",key+"="+value);
  args.push("-f","-");
  const script=`SET ROLE service_role;
    SET statement_timeout = '10s';
    SELECT source_revision FROM bm_intake_private.commit_typed_note_extraction(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::jsonb);`;
  return new Promise((resolve,reject)=>{
    const child=spawn("psql",args,{stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="";
    const watchdog=setTimeout(()=>child.kill("SIGKILL"),15000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data",part=>{stdout+=part;});
    child.stderr.on("data",part=>{stderr+=part;});
    child.once("error",error=>{clearTimeout(watchdog);reject(error);});
    child.once("close",code=>{
      clearTimeout(watchdog);
      if(code===0)resolve({ok:true,revision:Number(stdout.trim())});
      else resolve({ok:false,error:stderr||"psql exited "+code});
    });
    child.stdin.end(script);
  });
}

test("concurrent identical valid CAS writers produce exactly one audit",async()=>{
  const f=fixture();
  const outcomes=await Promise.all(Array.from({length:8},()=>cas(f,first)));
  const winners=outcomes.filter(x=>x.ok);
  const losers=outcomes.filter(x=>!x.ok);
  assert.equal(winners.length,1,JSON.stringify(outcomes));
  assert.deepEqual(winners.map(x=>x.revision),[2]);
  assert.equal(losers.length,7);
  for(const loser of losers)assert.match(loser.error,/Stale or already extracted source/);
  const saved=f.inspect();
  assert.equal(saved.revision,2);
  assert.deepEqual(saved.review,first);
  assert.equal(saved.original_text,text);
  assert.equal(saved.text_sha256,originalSha);
  assert.equal(saved.scope_review,null);
  assert.equal(saved.extraction_audit.length,1);
  assert.equal(saved.extraction_audit[0].actorId,f.actor);
  assert.equal(saved.extraction_audit[0].candidatesSha256,first.candidatesSha256);
});

test("competing distinct extractions cannot mix candidate and audit snapshots",async()=>{
  const f=fixture();
  const attempts=Array.from({length:4},(_,i)=>cas(f,i%2===0?first:second));
  const outcomes=await Promise.all(attempts);
  assert.equal(outcomes.filter(x=>x.ok).length,1,JSON.stringify(outcomes));
  for(const loser of outcomes.filter(x=>!x.ok))
    assert.match(loser.error,/Stale or already extracted source/);
  const saved=f.inspect();
  assert.equal(saved.revision,2);
  assert.equal(saved.extraction_audit.length,1);
  assert.ok([first.candidatesSha256,second.candidatesSha256]
    .includes(saved.review.candidatesSha256));
  const winningReview=saved.review.candidatesSha256===first.candidatesSha256?first:second;
  assert.deepEqual(saved.review,winningReview);
  assert.equal(saved.extraction_audit[0].candidatesSha256,winningReview.candidatesSha256);
  assert.equal(saved.extraction_audit[0].sourceSha256,winningReview.sourceSha256);
  assert.equal(saved.original_text,text);
});
