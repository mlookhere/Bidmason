import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The same read-only catalog query is also run against the connected live
// BidMason Supabase project. Its missing deployment objects MUST be
// reported as NOT READY; this CI checks the complete disposable schema.
const contract="bm-corrected-pricing-schema-preflight-v1";
const expectedChecks=24;
test("complete disposable corrected pricing catalog meets private staged contract",()=>{
 const raw=execFileSync("psql",[
  "-X","-A","-t","-v","ON_ERROR_STOP=1",
  "-f","db/corrected_pricing_schema_preflight.sql"
 ],{encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"]}).trim();
 const report=JSON.parse(raw);
 assert.deepEqual(Object.keys(report).sort(),[
  "checked","contract","missing","passed","staged_schema_ready"].sort());
 assert.equal(report.contract,contract);
 assert.equal(report.checked,expectedChecks);
 assert.equal(report.passed,expectedChecks,
  "staged private SQL or grant missing: "+JSON.stringify(report.missing));
 assert.equal(report.staged_schema_ready,true);
 assert.deepEqual(report.missing,[]);
 // Catalog readiness is NOT live Supabase Auth/RLS two-user/Storage tests,
 // nor does it enable quoting, sending or accepting customer estimates.
 assert.equal(Object.hasOwn(report,"production_ready"),false);
 assert.equal(Object.hasOwn(report,"deliveryAuthorized"),false);
});

test("preflight reads metadata only and never accesses customer or session records",async()=>{
 const {readFileSync}=await import("node:fs");
 const sql=readFileSync("db/corrected_pricing_schema_preflight.sql","utf8");
 assert.match(sql,/pg_catalog\.pg_class/);
 assert.match(sql,/to_regprocedure/);
 assert.doesNotMatch(sql,/\b(from|join|update|insert into|delete from)\s+(auth\.sessions|public\.bm_intake_sources|storage\.objects)\b/i);
});

/** Rollback-only fault injection: a new unintended grant or weakened definer
 * must produce a red deployment preflight, never a false green.
 * Runs only in the disposable PostgreSQL job, not connected Supabase. */
function rollbackProbe(mutation){
 const script=[
  "BEGIN;",
  mutation,
  "\\i db/corrected_pricing_schema_preflight.sql",
  "ROLLBACK;",
 ].join("\n");
 const raw=execFileSync("psql",["-X","-q","-A","-t","-v","ON_ERROR_STOP=1",
  "-f","-"],{input:script,encoding:"utf8",
  timeout:15000,stdio:["pipe","pipe","pipe"]}).trim();
 return JSON.parse(raw);
}
for(const [name,mutation,failedCheck] of [
 ["forced source RLS disabled",
  "ALTER TABLE public.bm_intake_sources NO FORCE ROW LEVEL SECURITY;",
  "typed_source_force_rls"],
 ["browser given source INSERT",
  "GRANT INSERT ON public.bm_intake_sources TO authenticated;",
  "typed_source_browser_write_denied"],
 ["private locked function changed to invoker",
  "ALTER FUNCTION bm_intake_private.read_corrected_internal_preview_session_locked(uuid,uuid,uuid,uuid,text) SECURITY INVOKER;",
  "session_locked_reader_definer_path"],
 ["private receipt given direct browser reads",
  "GRANT SELECT ON bm_intake_private.corrected_commercial_decisions TO authenticated;",
  "private_receipt_browser_dml_denied"],
 ["legacy pricing granted direct service execution",
  "GRANT EXECUTE ON FUNCTION bm_intake_private.read_corrected_internal_preview_inputs(uuid,uuid,uuid,text) TO service_role;",
  "internal_preview_indirect_only"],
]){
 test("preflight denies rollback-only regression: "+name,()=>{
  const report=rollbackProbe(mutation);
  assert.equal(report.checked,expectedChecks);
  assert.equal(report.staged_schema_ready,false);
  assert.ok(report.passed<expectedChecks);
  assert.ok(report.missing.includes(failedCheck),
   "Missing regression detection: "+failedCheck+" in "+JSON.stringify(report));
  // The enclosing transaction is always rolled back; a fault injection
  // must never persist or disturb the next existing CI test.
 });
}
test("rollback-only privilege fault injections leave full staged schema intact",()=>{
 const raw=execFileSync("psql",["-X","-q","-A","-t","-v","ON_ERROR_STOP=1",
  "-f","db/corrected_pricing_schema_preflight.sql"],{
   encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"],
  }).trim();
 const report=JSON.parse(raw);
 assert.equal(report.checked,expectedChecks);
 assert.equal(report.staged_schema_ready,true);
 assert.deepEqual(report.missing,[]);
});
