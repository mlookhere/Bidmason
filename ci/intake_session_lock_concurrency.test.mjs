/** Disposable PostgreSQL concurrency proof for the real 5-argument
 * corrected pricing reader. NEVER run against production/Supabase. */
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync,spawn} from "node:child_process";
const org="dededede-dede-4ede-8ede-dededededede";
const actor="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const sid="11111111-1111-4111-8111-111111111111";
const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-f","-"];
function sql(script,timeout=12000){
 return execFileSync("psql",args,{
  input:script,encoding:"utf8",timeout,stdio:["pipe","pipe","pipe"]
 }).trim();
}
function call(source,digest){
 return "select (bm_intake_private.read_corrected_internal_preview_session_locked("+
  "'"+org+"'::uuid,'"+actor+"'::uuid,'"+sid+"'::uuid,"+
  "'"+source+"'::uuid,'"+digest+"'::text)->>'state') as state;";
}
function waitForLeader(child){
 return new Promise((resolve,reject)=>{
  let data="",stderr="",ready=false;
  const timeout=setTimeout(()=>reject(Error("SQL lock not acquired within deadline")),9000);
  child.stderr.on("data",v=>{stderr+=String(v)});
  child.stdout.on("data",v=>{
   data+=String(v);
   if(!ready&&data.includes("LOCK_HELD")){
    ready=true;clearTimeout(timeout);resolve();
   }
  });
  child.once("error",e=>{clearTimeout(timeout);reject(e)});
  child.once("close",code=>{
   if(!ready){
    clearTimeout(timeout);
    reject(Error("Lock transaction failed "+code+": "+stderr.replaceAll(sid,"[SESSION]")));
   }
  });
 });
}
async function finish(child){
 if(child.exitCode!==null)return child.exitCode;
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
   child.kill("SIGKILL");
   reject(Error("Timed out waiting for SQL transaction rollback"));
  },8000);
  child.once("close",code=>{clearTimeout(timer);resolve(code)});
  child.once("error",e=>{clearTimeout(timer);reject(e)});
 });
}
test("session-locked preview holds session row against concurrent signout DELETE",
 {timeout:17000},async()=>{
  assert.equal(process.env.BIDMASON_CI_DISPOSABLE_POSTGRES,"1");
  assert.deepEqual(
   [process.env.PGHOST,process.env.PGPORT,process.env.PGUSER,process.env.PGDATABASE],
   ["127.0.0.1","5432","postgres","postgres"]);
  const record=JSON.parse(sql(
   "select row_to_json(x) from (select source_id::text,decision_sha256 "+
   "from bm_intake_private.corrected_commercial_decisions "+
   "where organization_id='"+org+"'::uuid) x;"));
  assert.match(record.source_id,/^[a-f0-9-]{36}$/);
  assert.match(record.decision_sha256,/^[a-f0-9]{64}$/);
  sql("insert into auth.sessions(id,user_id) values('"+sid+"'::uuid,'"+actor+"'::uuid);");
  let leader;
  try {
   leader=spawn("psql",args,{stdio:["pipe","pipe","pipe"]});
   const ready=waitForLeader(leader);
   leader.stdin.end([
    "begin;",
    "set role service_role;",
    call(record.source_id,record.decision_sha256),
    "select 'LOCK_HELD';",
    "select pg_sleep(4);",
    "rollback;"
   ].join("\n"));
   await ready;

   let blocked=false;
   try {
    sql("set lock_timeout='700ms';delete from auth.sessions "+
        "where id='"+sid+"'::uuid;",5000);
   }catch(e){
    blocked=true;
    assert.match(String(e.stderr),/canceling statement due to lock timeout/i,
      "Signout must be blocked by the session-row lock, not unrelated SQL failure");
   }
   assert.equal(blocked,true,"Signout bypassed the active preview row lock");
   assert.equal(await finish(leader),0);

   const deleted=sql("delete from auth.sessions where id='"+sid+"'::uuid returning id;");
   assert.equal(deleted,sid);
   assert.throws(
     ()=>sql("set role service_role;"+call(record.source_id,record.decision_sha256)),
     err=>/Current verified session row required/i.test(String(err.stderr)),
     "After signout, another preview must fail even with the same actor and decision");
  }finally{
   if(leader&&leader.exitCode===null)leader.kill("SIGKILL");
   sql("delete from auth.sessions where id='"+sid+"'::uuid;");
  }
 });
