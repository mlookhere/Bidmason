/**
 * STAGING / CI ONLY: executable integration proof between the real JS
 * extraction adapter and the REAL private functions on ephemeral Postgres.
 * Not a Supabase Auth test, not a production DB driver or a deployment.
 *
 * The psql variable substitution below SQL-quotes CI-controlled values.
 * No customer, browser, provider or untrusted external data is involved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createTrustedTypedNoteExtraction }
  from "../lib/trusted-typed-note-extraction.ts";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGINAL = "Paint 🧱 café soffit and 2 rooms.";
let counter = 700;

function uuid(n) {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12,"0")}`;
}

function psql(script, variables = {}) {
  const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) {
    if (!/^p[1-9][0-9]*$/.test(name) || typeof value !== "string") {
      throw new TypeError("Invalid isolated PostgreSQL fixture parameter");
    }
    args.push("-v", `${name}=${value}`);
  }
  args.push("-f", "-");
  return execFileSync("psql", args, {
    input: script, encoding: "utf8", timeout: 10000,
    stdio: ["pipe","pipe","pipe"],
  }).trim();
}

function query(sql, params, role = true) {
  // This CI-only psql adapter intentionally accepts only our two pre-defined
  // private function calls. Production MUST use a native parameterized driver.
  if (!Array.isArray(params) || !params.every(p => typeof p === "string")
    || !/^select (record from bm_intake_private\.read_typed_note_for_extraction|source_revision, original_sha256, candidates_sha256\s+from bm_intake_private\.commit_typed_note_extraction)\(/s
      .test(sql.trim())
    || (sql.includes("read_typed_note_for_extraction") && params.length !== 3)
    || (sql.includes("commit_typed_note_extraction") && params.length !== 5)) {
    throw new Error("Unexpected SQL or invalid private function parameters");
  }
  const variables = Object.fromEntries(params.map((p,i) => [`p${i+1}`,p]));
  const prepared = sql.replace(/\$([1-9][0-9]*)(?=::)/g,
    (_, n) => `:'p${n}'`);
  if (prepared.includes("$")) {
    throw new Error("Unexpected unresolved SQL parameter");
  }
  const result = psql(`${role ? "SET ROLE service_role;\n" : ""}SELECT row_to_json(v)
    FROM (${prepared}) AS v;\n`, variables);
  return {rows:result ? result.split("\n").map(x => JSON.parse(x)) : []};
}

function fixture() {
  const ordinal = ++counter;
  const actor = uuid(ordinal);
  const requestId = uuid(ordinal + 2000);
  const other = uuid(ordinal + 3000);
  psql(`INSERT INTO public.bm_memberships(organization_id,user_id,member_role)
    VALUES (:'p1'::uuid,:'p2'::uuid,'operator'),
      (:'p1'::uuid,:'p3'::uuid,'contractor');\n`,
    {p1:ORG,p2:actor,p3:other});
  const sourceId = psql(`SET ROLE service_role;
    SELECT source_id FROM bm_intake_private.create_typed_note(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);\n`,
    {p1:ORG,p2:actor,p3:requestId,p4:ORIGINAL});
  assert.match(sourceId,/^[0-9a-f-]{36}$/);
  let active=true, identity=actor;
  const calls=[];
  const auth={
    async verifyActiveSession(token) {
      if (!active || token !== "ci-synthetic-token") {
        throw new Error("Synthetic session revoked");
      }
      return {userId:identity};
    },
  };
  const db={async query(sql,params){
    calls.push({sql,params});
    return query(sql,params);
  }};
  const input={session:"ci-synthetic-token",
    organizationId:ORG,sourceId,
    rawExtractionResponse:extraction()};
  const api=createTrustedTypedNoteExtraction(auth,db);
  return {actor,other,sourceId,auth,db,input,api,calls,
    revokeSession(){active=false;},
    changeActor(){identity=other;},
    revokeMembership(){psql(`DELETE FROM public.bm_memberships
      WHERE organization_id=:'p1'::uuid AND user_id=:'p2'::uuid;\n`,
      {p1:ORG,p2:actor});},
    stored(){const s=psql(`SELECT row_to_json(t) FROM (
      SELECT revision,review,extraction_audit,original_text,text_sha256
      FROM public.bm_intake_sources
      WHERE organization_id=:'p1'::uuid AND id=:'p2'::uuid
    ) t;\n`,{p1:ORG,p2:sourceId});return JSON.parse(s);},
  };
}

function extraction() {
  const excerpt="🧱 café";
  const start=ORIGINAL.indexOf(excerpt);
  assert.ok(start>=0);
  return JSON.stringify({candidates:[{
    serviceCode:"painting",units:2,start,end:start+excerpt.length,excerpt,
  }]});
}

test("real SQL and JS validate UTF-16 extraction and persist only review",async()=>{
  const f=fixture();
  const result=await f.api.commit(f.input);
  assert.equal(result.state,"needs-human-review");
  assert.equal(result.revision,2);
  assert.equal(f.calls.length,3);
  assert.match(f.calls[0].sql,/read_typed_note_for_extraction/);
  assert.match(f.calls[1].sql,/commit_typed_note_extraction/);
  assert.match(f.calls[2].sql,/read_typed_note_for_extraction/);
  assert.deepEqual(f.calls[1].params.slice(0,3),[ORG,f.actor,f.sourceId]);
  assert.equal(f.stored().revision,2);
  assert.equal(f.stored().original_text,ORIGINAL);
  assert.equal(f.stored().review.state,"needs-human-review");
  assert.equal(f.stored().review.candidates[0].excerpt,"🧱 café");
  assert.equal(f.stored().extraction_audit[0].actorId,f.actor);
  assert.equal(f.stored().extraction_audit[0].candidatesSha256,result.candidatesSha256);
  assert.equal(result.sourceSha256,f.stored().review.sourceSha256);
  await assert.rejects(f.api.commit(f.input),/stale or already reviewed/);
  assert.equal(f.calls.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,1);
});

test("same-tenant other creator and foreign tenant cannot read or CAS",async()=>{
  const f=fixture();
  f.changeActor();
  await assert.rejects(f.api.commit(f.input));
  await assert.rejects(f.api.commit({...f.input,organizationId:FOREIGN_ORG}));
  assert.equal(f.stored().revision,1);
  assert.equal(f.calls.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,0);
});

test("revocation after valid original read rejects SQL CAS without mutation",async()=>{
  const f=fixture(), original=f.db.query;
  f.db.query=async(sql,params)=>{
    const response=await original(sql,params);
    if(sql.includes("read_typed_note_for_extraction"))f.revokeMembership();
    return response;
  };
  const api=createTrustedTypedNoteExtraction(f.auth,f.db);
  await assert.rejects(api.commit(f.input));
  assert.equal(f.stored().revision,1);
  assert.equal(f.calls.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,1);
});

test("revoked synthetic session before CAS cannot mutate the original",async()=>{
  const f=fixture(), original=f.db.query;
  f.db.query=async(sql,params)=>{
    const response=await original(sql,params);
    if(sql.includes("read_typed_note_for_extraction"))f.revokeSession();
    return response;
  };
  await assert.rejects(createTrustedTypedNoteExtraction(f.auth,f.db)
    .commit(f.input),/revoked/);
  assert.equal(f.stored().revision,1);
  assert.equal(f.calls.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,0);
});

test("malicious model-side price and spoofed offsets never reach CAS",async()=>{
  const f=fixture();
  const bad=JSON.parse(extraction());
  bad.candidates[0].rateCents=1;
  await assert.rejects(f.api.commit({...f.input,
    rawExtractionResponse:JSON.stringify(bad)}));
  delete bad.candidates[0].rateCents;
  bad.candidates[0].start++;
  await assert.rejects(f.api.commit({...f.input,
    rawExtractionResponse:JSON.stringify(bad)}));
  assert.equal(f.stored().revision,1);
  assert.equal(f.calls.filter(x=>x.sql.includes("commit_typed_note_extraction")).length,0);
});
