/**
 * STAGING ONLY. Real disposable PostgreSQL contract for the server-owned
 * scope CAS adapter, not production Supabase Auth or real company approval.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {buildReviewWorkbench} from "../lib/intake-review-workbench.ts";
import {canonicalCompanyPolicyText,companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";
import {createTrustedTypedNoteScopeCommit}
  from "../lib/trusted-typed-note-scope-commit.ts";

function psql(script,values={}) {
  const a=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [name,value] of Object.entries(values)) {
    if(!/^p[1-9]$/.test(name)||typeof value!=="string")
      throw Error("Invalid synthetic PostgreSQL variable");
    a.push("-v",name+"="+value);
  }
  a.push("-f","-");
  return execFileSync("psql",a,{input:script,encoding:"utf8",
    timeout:12000,stdio:["pipe","pipe","pipe"]}).trim();
}
function query(sql,params) {
  if(!Array.isArray(params) || !params.every(v=>typeof v==="string")
    || !(/^(select record from bm_intake_private\.read_typed_note_for_extraction|select h\.revision,h\.policy_sha256,v\.policy,|select source_revision, reviewed_selection_sha256\s+from bm_intake_private\.commit_typed_note_scope_review)/s.test(sql.trim()))) {
    throw Error("Unsupported private scope SQL or non-string parameters");
  }
  const expected=sql.includes("read_typed_note_for_extraction")?3:
    sql.includes("commit_typed_note_scope_review")?6:2;
  if(params.length!==expected)throw Error("Wrong private SQL argument count");
  const variables=Object.fromEntries(params.map((v,i)=>["p"+(i+1),v]));
  const prepared=sql.replace(/\$([1-6])(?=::)/g,(_m,n)=>":'p"+n+"'");
  if(prepared.includes("$"))throw Error("Unbound private SQL placeholder");
  const line=psql("set role service_role; select row_to_json(x) from ("+
    prepared+") x;",variables);
  return {rows:line?[JSON.parse(line)]:[]};
}
const policy={revision:1,pricing:{
  policyId:"synthetic-bridge-scope-v1",currency:"USD",
  minimum:{rule:"none",cents:0},
  calculationOrder:"discount-then-surcharge",
  services:{painting:{label:"Painting",unit:"room",rateCents:13000,
    billing:"charged",optionalAddon:true}},
},tax:{method:"none",bps:0}};
const original={kind:"typed-note",text:"Paint 🧱 two rooms"};
const candidate={serviceCode:"painting",units:2,start:0,
  end:original.text.length,excerpt:original.text};
const review=prepareExtractionReview(original,[candidate]);

function fixture({lostAck=false,revokeAfterReadback=false}={}) {
  const org=randomUUID(),actor=randomUUID(),reviewer=randomUUID(),request=randomUUID();
  psql(`insert into public.bm_organizations(id,slug,name)
    values (:'p1'::uuid,:'p2'::text,'Synthetic authorized scope');
    insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p3'::uuid,'operator'),
           (:'p1'::uuid,:'p4'::uuid,'owner');`,
    {p1:org,p2:"scope-"+org,p3:actor,p4:reviewer});
  psql(`set role service_role;
    select bm_intake_private.ci_stage_approved_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:actor,p3:reviewer,p4:canonicalCompanyPolicyText(policy)});
  const sha=psql(`set role service_role;
    select activated_sha256 from bm_intake_private.activate_scope_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,1,:'p4'::text);`,
    {p1:org,p2:actor,p3:reviewer,p4:canonicalCompanyPolicyText(policy)});
  assert.equal(sha,companyPolicySha256(policy));
  const sourceId=psql(`set role service_role;
    select source_id from bm_intake_private.create_typed_note(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:actor,p3:request,p4:original.text});
  const originalSha=createHash("sha256").update(original.text).digest("hex");
  assert.equal(psql(`set role service_role;
    select source_revision from bm_intake_private.commit_typed_note_extraction(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::jsonb);`,
    {p1:org,p2:actor,p3:sourceId,p4:originalSha,
      p5:JSON.stringify(review)}),"2");
  let sessionValid=true,authenticatedActor=actor,authCalls=0,writes=0;
  let sourceReads=0;
  const calls=[];
  const auth={async verifyActiveSession(session) {
    authCalls++;
    if(session!=="ci-private-session"||!sessionValid)
      throw Error("Synthetic session revoked");
    return {userId:authenticatedActor};
  }};
  const db={async query(statement,params) {
    calls.push({statement,params});
    const result=query(statement,params);
    if(statement.includes("read_typed_note_for_extraction")) {
      sourceReads++;
      if (revokeAfterReadback && sourceReads===2) {
        // Readback WAS authorized; revoke the DB membership before the
        // final separate privileged active-policy query starts.
        psql(`delete from public.bm_memberships
          where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
          {p1:org,p2:actor});
      }
    }
    if(statement.includes("commit_typed_note_scope_review")) {
      writes++;
      if(lostAck)throw Error("Simulated lost PostgreSQL CAS acknowledgement");
    }
    return result;
  }};
  const api=createTrustedTypedNoteScopeCommit(auth,db);
  const input={session:"ci-private-session",organizationId:org,sourceId,
    reviewKey:buildReviewWorkbench(original,review,policy).key,
    selectedIndices:[0],acceptedAddonCodes:["painting"]};
  return {org,actor,reviewer,sourceId,api,input,calls,
    get writes(){return writes;},get authCalls(){return authCalls;},
    changeActor(){authenticatedActor=reviewer;},
    revokeMember(){psql(`delete from public.bm_memberships
      where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
      {p1:org,p2:actor});},
    get stored(){return JSON.parse(psql(`select row_to_json(x) from (
      select revision,scope_review,review,original_text,extraction_audit
      from public.bm_intake_sources where organization_id=:'p1'::uuid
        and id=:'p2'::uuid) x;`,{p1:org,p2:sourceId}));},
  };
}

test("trusted TypeScript scope CAS commits through actual tenant-private SQL",async()=>{
  const f=fixture();
  assert.equal(f.stored.revision,2);
  const out=await f.api.commit(f.input);
  assert.equal(out.state,"reviewed-for-proposal-draft");
  assert.equal(out.revision,3);
  assert.equal(out.reviewedBy,f.actor);
  assert.equal(f.writes,1);
  assert.equal(f.authCalls,6);
  const saved=f.stored;
  assert.equal(saved.revision,3);
  assert.equal(saved.scope_review.reviewedSelectionSha256,out.reviewedSelectionSha256);
  assert.equal(saved.scope_review.policySha256,companyPolicySha256(policy));
  assert.deepEqual(saved.review,review);
  assert.deepEqual(saved.original_text,original.text);
  assert.equal(saved.extraction_audit.length,1);
  assert.equal(saved.extraction_audit[0].actorId,f.actor);
  assert.equal(Object.hasOwn(out,"quote"),false);
  assert.equal(Object.hasOwn(out,"approved"),false);
  await assert.rejects(f.api.commit(f.input),/not awaiting human review/);
  assert.equal(f.writes,1);
});
test("foreign actor and forged review key cannot reach private scope write",async()=>{
  const f=fixture();
  await assert.rejects(f.api.commit({...f.input,reviewKey:"f".repeat(64)}),
    /changed; refresh/);
  assert.equal(f.writes,0);
  f.changeActor();
  await assert.rejects(f.api.commit(f.input),/creator-owned|unavailable/);
  assert.equal(f.writes,0);
  assert.equal(f.stored.revision,2);
});
test("lost database CAS response is indeterminate, never blindly retried",async()=>{
  const f=fixture({lostAck:true});
  await assert.rejects(f.api.commit(f.input),/Simulated lost/);
  assert.equal(f.writes,1);
  assert.equal(f.stored.revision,3);
  assert.equal(f.stored.extraction_audit.length,1);
});
test("privileged active policy lookup enforces tenant membership in its own SQL",async()=>{
  const f=fixture();
  const policyStatement=f.api.commit(f.input);
  await policyStatement;
  const readPolicy=f.calls.filter(x=>x.statement.includes("active_policy_heads"));
  assert.equal(readPolicy.length,2);
  for(const call of readPolicy) {
    assert.deepEqual(call.params,[f.org,f.actor]);
    assert.ok(call.statement.includes("join public.bm_memberships m"));
    assert.match(call.statement,/for share of h,v,m/);
  }
  // A separate privileged read with a nonmember actor must return no policy,
  // even though service_role can see the private policy tables.
  const sqlText=readPolicy[0].statement;
  const denied=query(sqlText,[f.org,randomUUID()]);
  assert.deepEqual(denied.rows,[]);
  f.revokeMember();
  const revoked=query(sqlText,[f.org,f.actor]);
  assert.deepEqual(revoked.rows,[]);
});

test("revoked membership fails before committing any draft",async()=>{
  const f=fixture();
  f.revokeMember();
  await assert.rejects(f.api.commit(f.input));
  assert.equal(f.writes,0);
  assert.equal(f.stored.revision,2);
});

test("actual PG rejects active policy read after membership revoked post-commit",async()=>{
  const f=fixture({revokeAfterReadback:true});
  await assert.rejects(f.api.commit(f.input),/No unambiguous approved current policy/);
  assert.equal(f.writes,1);
  assert.equal(f.stored.revision,3);
  assert.equal(f.stored.extraction_audit.length,1);
  const policyCalls=f.calls.filter(x=>x.statement.includes("active_policy_heads"));
  assert.equal(policyCalls.length,2);
  for(const call of policyCalls){
    assert.deepEqual(call.params,[f.org,f.actor]);
    assert.ok(call.statement.includes("join public.bm_memberships m"));
    assert.match(call.statement,/for share of h,v,m/);
  }
  // This is an indeterminate post-write outcome; no retry occurs.
});


test("actual PG read-only workbench and policy preview bind original typed note to approved ratecard",async()=>{
 const f=fixture();
 const selector={session:f.input.session,organizationId:f.org,sourceId:f.sourceId};
 const workbench=await f.api.readWorkbench(selector);
 assert.equal(workbench.state,"requires-human-service-review");
 assert.equal(workbench.sourceRevision,2);
 assert.equal(workbench.model.key,f.input.reviewKey);
 assert.equal(workbench.model.rows.length,1);
 assert.equal(workbench.model.rows[0].status,"optional");
 assert.equal(workbench.model.rows[0].excerpt,original.text);
 assert.equal(f.writes,0);
 const result=await f.api.preview(f.input);
 assert.equal(result.state,"preview-only");
 assert.equal(result.reviewKey,f.input.reviewKey);
 assert.equal(result.economics.policySha256,companyPolicySha256(policy));
 assert.equal(result.economics.policyRevision,1);
 assert.equal(result.selectedServices[0].addonAccepted,true);
 assert.equal(result.sourceId,f.sourceId);
 assert.equal(f.stored.revision,2);
 assert.equal(f.writes,0);
 assert.equal(f.calls.filter(c=>c.statement.includes("active_policy_heads")).length,4);
 assert.equal(f.calls.filter(c=>c.statement.includes("read_typed_note_for_extraction")).length,4);
 assert.equal(f.calls.filter(c=>c.statement.includes("commit_typed_note_scope_review")).length,0);
 assert.equal(Object.hasOwn(result,"send"),false);
 assert.equal(Object.hasOwn(result,"approved"),false);
 // Pending a separate human commit, no client amount or forged source can
 // substitute for the real source-owner and current company ratecard.
 await assert.rejects(f.api.preview({...f.input,acceptedAddonCodes:[]}));
 await assert.rejects(f.api.preview({...f.input,policy,approved:true}),TypeError);
 assert.equal(f.writes,0);
});
test("actual PG rechecks source ownership and reviewer permission for read-only workbench",async()=>{
 const f=fixture();
 const selector={session:f.input.session,organizationId:f.org,sourceId:f.sourceId};
 f.changeActor();
 await assert.rejects(f.api.readWorkbench(selector));
 assert.equal(f.writes,0);
 const g=fixture();
 g.revokeMember();
 await assert.rejects(g.api.preview(g.input));
 assert.equal(g.writes,0);
 const h=fixture();
 await h.api.commit(h.input);
 await assert.rejects(h.api.readWorkbench({session:h.input.session,
   organizationId:h.org,sourceId:h.sourceId}),/not awaiting human review/);
 assert.equal(h.writes,1);
});
