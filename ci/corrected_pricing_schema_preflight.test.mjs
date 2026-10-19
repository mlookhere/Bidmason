import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The same read-only catalog query is also run against the connected live
// BidMason Supabase project. Its missing deployment objects MUST be
// reported as NOT READY; this CI checks the complete disposable schema.
const contract="bm-corrected-pricing-schema-preflight-v1";
const expectedChecks=14;
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
