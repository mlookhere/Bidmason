import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

const text=path=>readFileSync(path,"utf8");
const workflow=text(".github/workflows/ci-pr.yml");
const helper=text("ci/install_item4_on_item3_disposable.sh");
const authFixture=text("ci/db_auth_session_revocation_test.sql");
const ready=["intake-db","item3-intake-compat"];
function migrationPaths(flow=workflow){
 const start=flow.indexOf("\n  intake-db:");
 const end=flow.indexOf("\n  item3-intake-compat:",start+1);
 if(start===-1||end===-1)throw Error("Named mandatory DB jobs missing");
 const job=flow.slice(start,end);
 return [...job.matchAll(/^\s{8}run: psql -X -v ON_ERROR_STOP=1 -f (db\/[a-z0-9_]+\.sql)$/gm)]
  .map(m=>m[1]);
}
function helperPaths(script=helper){
 const match=script.match(/readonly sql_files=\(\s*\n([\s\S]*?)^\)/m);
 if(!match)throw Error("Disposable installer migration manifest missing");
 return match[1].split("\n").map(s=>s.trim()).filter(Boolean);
}
function compare(flow=workflow,script=helper){
 const all=migrationPaths(flow);
 const expected=all.filter(x=>![
  "db/typed_note_foundation.sql",
  "db/staged_corrected_preview_session_lock.sql",
  "db/staged_seal_legacy_corrected_preview.sql",
 ].includes(x));
 const actual=helperPaths(script);
 assert.ok(expected.length>=16,"Main intake install set unexpectedly short");
 assert.equal(new Set(all).size,all.length,"Main intake job repeats SQL migrations");
 assert.equal(new Set(actual).size,actual.length,"Combined-schema helper repeats migrations");
 assert.deepEqual(actual,expected,"Item3 compatibility SQL migrations must exactly match intake-db order");
 const tail=script.slice(script.indexOf("done\n")+5);
 const terms=[
  "ci/db_auth_session_revocation_test.sql",
  "db/staged_corrected_preview_session_lock.sql",
  "db/staged_seal_legacy_corrected_preview.sql",
 ];
 const positions=terms.map(x=>tail.indexOf(x));
 assert.ok(positions.every(i=>i>=0), "Required Auth/lock/seal install missing");
 assert.ok(positions.every((n,i)=>i===0||n>positions[i-1]),
  "Combined-schema Auth, lock, and seal must stay in this order");
 assert.match(authFixture,/\\i db\/staged_auth_session_presence\.sql/);
 assert.ok(ready.every(x=>flow.includes("\n  "+x+":")),
  "Mandatory PostgreSQL jobs may not disappear");
 assert.match(flow,/\n\s+- name: Prove all 24 private-schema and Auth-session grants on combined Item 3 and 4\n\s+run: node --test ci\/corrected_pricing_schema_preflight\.test\.mjs/);
 assert.match(flow,/\n\s+- name: Reprove Item 3 tenant read isolation after complete Item 4 schema\n\s+run: psql -X -v ON_ERROR_STOP=1 -f ci\/db_item3_post_intake_rls_audit\.sql/);
 assert.match(script,/BIDMASON_CI_DISPOSABLE_POSTGRES/);
 assert.match(script,/PGHOST:-/);
 assert.match(script,/PGDATABASE:-/);
 return {all,expected,actual};
}

test("real-Item3 compatibility installs exactly all Item4 SQL migrations in identical dependency order",()=>{
 const info=compare();
 assert.equal(info.expected.length,16);
});
test("main intake migration addition cannot silently be omitted in compatibility job",()=>{
 const first="      - name: Install private canonical candidate digest";
 const pos=workflow.indexOf(first);
 assert.ok(pos>0);
 const injected=workflow.slice(0,pos)+
  "      - name: Install new private migration\n"+
  "        run: psql -X -v ON_ERROR_STOP=1 -f db/new_private_migration.sql\n"+
  workflow.slice(pos);
 assert.throws(()=>compare(injected,helper),/exactly match intake-db order/);
});
test("reordering combined-schema migrations is detected rather than accepted",()=>{
 const items=helperPaths();
 const wrong=[...items];
 [wrong[1],wrong[2]]=[wrong[2],wrong[1]];
 const altered=helper.replace(
  /readonly sql_files=\(\s*\n[\s\S]*?^\)/m,
  "readonly sql_files=(\n"+wrong.map(x=>"  "+x).join("\n")+"\n)");
 assert.throws(()=>compare(workflow,altered),/exactly match intake-db order/);
});
test("omitting hardened session-lock or sealing migration fails closed",()=>{
 const wrong=helper.replace(
  "psql -X -v ON_ERROR_STOP=1 -f db/staged_seal_legacy_corrected_preview.sql >/dev/null",
  "echo not-installed");
 assert.throws(()=>compare(workflow,wrong),/Required Auth\/lock\/seal install missing/);
});

test("combined installer actually runs all migrations and refuses unsafe database targets",()=>{
 const dir=mkdtempSync(join(tmpdir(),"bidmason-sql-parity-"));
 const capture=join(dir,"calls");
 try{
  writeFileSync(join(dir,"psql"),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$BIDMASON_PARITY_CAPTURE"\n',{mode:0o755});
  const allowed={
   ...process.env,
   PATH:dir+":"+process.env.PATH,
   BIDMASON_PARITY_CAPTURE:capture,
   BIDMASON_CI_DISPOSABLE_POSTGRES:"1",
   PGHOST:"127.0.0.1",PGPORT:"5432",PGUSER:"postgres",PGDATABASE:"postgres",
   PGHOSTADDR:"",PGSERVICE:"",PGSERVICEFILE:"",PGOPTIONS:""
  };
  const run=env=>spawnSync("bash",["ci/install_item4_on_item3_disposable.sh"],{
   env,encoding:"utf8",timeout:15000
  });
  const success=run(allowed);
  assert.equal(success.status,0,success.stderr);
  const invocations=readFileSync(capture,"utf8").trim().split("\n");
  const executed=invocations.filter(line=>line.includes(" -f "))
   .map(line=>line.split(" -f ")[1]);
  assert.deepEqual(executed,[
   ...helperPaths(),
   "ci/db_auth_session_revocation_test.sql",
   "db/staged_corrected_preview_session_lock.sql",
   "db/staged_seal_legacy_corrected_preview.sql"
  ],"SQL file names must be executed in the same order, not just present as text");
  assert.equal(invocations.length,executed.length+1,"Expected one additional inline Auth grant guard");
  for(const [key,value] of [
   ["BIDMASON_CI_DISPOSABLE_POSTGRES","0"],
   ["PGHOST","production.example"],
   ["PGPORT","5433"],
   ["PGUSER","service_role"],
   ["PGDATABASE","customer_database"],
   ["PGHOSTADDR","192.0.2.1"],
   ["PGSERVICE","unexpected-service"],
   ["PGSERVICEFILE","/tmp/alternate-pg-service"],
   ["PGOPTIONS","-c search_path=public"]
  ]){
   writeFileSync(capture,"");
   const denied=run({...allowed,[key]:value});
   assert.equal(denied.status,1,`Unsafe ${key} unexpectedly passed: ${denied.stderr}`);
   assert.match(denied.stderr,/REFUSED: this migration integration/);
   assert.equal(readFileSync(capture,"utf8"),"",`Unsafe ${key} invoked SQL`);
  }
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});

test("combined disposable installer stops on the first rejected SQL migration",()=>{
 const dir=mkdtempSync(join(tmpdir(),"bidmason-sql-failure-"));
 const capture=join(dir,"calls");
 try{
  writeFileSync(join(dir,"psql"),[
   "#!/bin/sh",
   'printf "%s\\n" "$*" >> "$BIDMASON_PARITY_CAPTURE"',
   'case "$*" in *db/typed_note_candidates_digest.sql*) exit 23;; esac',
   "exit 0",
   ""
  ].join("\n"),{mode:0o755});
  const result=spawnSync("bash",["ci/install_item4_on_item3_disposable.sh"],{
   encoding:"utf8",timeout:15000,
   env:{...process.env,PATH:dir+":"+process.env.PATH,
    BIDMASON_PARITY_CAPTURE:capture,BIDMASON_CI_DISPOSABLE_POSTGRES:"1",
    PGHOST:"127.0.0.1",PGPORT:"5432",PGUSER:"postgres",PGDATABASE:"postgres",
    PGHOSTADDR:"",PGSERVICE:"",PGSERVICEFILE:"",PGOPTIONS:""}
  });
  assert.equal(result.status,23,"Installer must propagate the first psql failure");
  const invocations=readFileSync(capture,"utf8").trim().split("\n");
  assert.equal(invocations.length,2,"Installer invoked SQL after the first failed migration");
  assert.ok(invocations[1].includes("db/typed_note_candidates_digest.sql"));
  assert.doesNotMatch(result.stdout,/PASS: complete staged Item 4/);
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});
