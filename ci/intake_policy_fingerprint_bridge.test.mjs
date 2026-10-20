/**
 * Disposable PostgreSQL contract test. A synthetic two-person approval is
 * prepared by the actual TypeScript company-policy domain, then installed
 * through real private SQL, followed by JS extraction and human scope review.
 * This is NOT production Auth, real customer approval or a driver adapter.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomUUID,createHash} from "node:crypto";
import {submitPolicyDraft,reviewPolicyDraft,readActivePolicy}
  from "../lib/company-policy-revisions.ts";
import {canonicalCompanyPolicyText,companyPolicySha256}
  from "../lib/company-policy-fingerprint.ts";
import {prepareExtractionReview} from "../lib/intake-review.ts";
import {buildReviewWorkbench} from "../lib/intake-review-workbench.ts";
import {prepareReviewPreviewRequest} from "../lib/intake-review-selection.ts";
import {previewReviewedEconomics} from "../lib/intake-quote-preview.ts";
import {createTrustedTypedNoteScopeRecovery}
  from "../lib/trusted-typed-note-scope-recovery.ts";

function sql(script,params={}) {
  const args=["-X","-q","-A","-t","-v","ON_ERROR_STOP=1"];
  for(const [key,value] of Object.entries(params)) {
    if(!/^p[1-9]$/.test(key)||typeof value!=="string")
      throw new TypeError("Invalid CI SQL parameter");
    args.push("-v",key+"="+value);
  }
  args.push("-f","-");
  return execFileSync("psql",args,{input:script,encoding:"utf8",
    timeout:10000,stdio:["pipe","pipe","pipe"]}).trim();
}
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");

test("real PG activation SHA equals TS approval, preview and reviewed draft",async()=>{
  const org=randomUUID(),author=randomUUID(),reviewer=randomUUID();
  const request=randomUUID();
  sql(`insert into public.bm_organizations(id,slug,name)
    values (:'p1'::uuid,:'p2'::text,'Synthetic JS Policy Bridge');
    insert into public.bm_memberships(organization_id,user_id,member_role)
    values (:'p1'::uuid,:'p3'::uuid,'operator'),
           (:'p1'::uuid,:'p4'::uuid,'owner');`,
    {p1:org,p2:"bridge-"+org,p3:author,p4:reviewer});

  const policy={
    revision:1,
    pricing:{policyId:"synthetic-bridge-v1",currency:"USD",
      minimum:{rule:"quote",cents:12000},
      calculationOrder:"discount-then-surcharge",
      services:{
        painting:{label:"Repaint 🧱",unit:"room",rateCents:7000,
          billing:"charged",optionalAddon:true},
        cleaning:{label:"Hall cleaning",unit:"visit",rateCents:47500,
          billing:"pending"},
      }},
    tax:{method:"none",bps:0},
    excludedServiceCodes:[],
  };
  const draft=submitPolicyDraft(null,{organizationId:org,submittedBy:author,
    policy,expectedRevision:0,expectedSha256:null});
  const approved=reviewPolicyDraft(draft,{organizationId:org,reviewedBy:reviewer,
    decision:"approve",expectedRevision:1,
    expectedSha256:draft.revisions[0].policySha256});
  const active=readActivePolicy(approved,org);
  const fingerprint=approved.revisions[0].policySha256;
  assert.equal(companyPolicySha256(active),fingerprint);
  sql(`set role service_role;
    select bm_intake_private.ci_stage_approved_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:author,p3:reviewer,p4:canonicalCompanyPolicyText(active)});
  const activated=JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
      select activated_revision,activated_sha256
      from bm_intake_private.activate_scope_policy(
        :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,1,:'p4'::text)
    ) x;`,{p1:org,p2:author,p3:reviewer,
      p4:canonicalCompanyPolicyText(active)}));
  assert.equal(activated.activated_revision,1);
  assert.equal(activated.activated_sha256,fingerprint);
  const stored=JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
      select h.revision,h.policy_sha256,v.policy
      from bm_intake_private.active_policy_heads h
      join bm_intake_private.approved_policy_versions v
        on h.organization_id=v.organization_id
        and h.revision=v.revision and h.policy_sha256=v.policy_sha256
      where h.organization_id=:'p1'::uuid
    ) x;`,{p1:org}));
  assert.equal(stored.policy_sha256,fingerprint);
  assert.deepEqual(stored.policy,active);

  const original={kind:"typed-note",text:"Paint 🧱 two rooms, clean hallway"};
  const sourceId=sql(`set role service_role;
    select source_id from bm_intake_private.create_typed_note(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:author,p3:request,p4:original.text});
  const candidate=(serviceCode,excerpt,units)=>{
    const start=original.text.indexOf(excerpt);
    assert.ok(start>=0);
    return {serviceCode,units,start,end:start+excerpt.length,excerpt};
  };
  const review=prepareExtractionReview(original,[
    candidate("painting","Paint 🧱",2),
    candidate("cleaning","clean hallway",1),
  ]);
  const originalSha=hash(original.text);
  assert.equal(sql(`set role service_role;
    select source_revision from bm_intake_private.commit_typed_note_extraction(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::jsonb);`,
    {p1:org,p2:author,p3:sourceId,p4:originalSha,
      p5:JSON.stringify(review)}),"2");

  const model=buildReviewWorkbench(original,review,active);
  assert.equal(model.rows[0].status,"optional");
  assert.equal(model.rows[1].status,"pending");
  const selection=prepareReviewPreviewRequest(model,{
    key:model.key,selectedIndices:[0],acceptedAddonCodes:["painting"]});
  const preview=previewReviewedEconomics(original,review,
    selection.selectedIndices,active,selection.acceptedAddonCodes);
  assert.equal(preview.economics.policySha256,fingerprint);
  assert.equal(preview.economics.quote.totalCents,14000);
  const scope={
    state:"reviewed-for-proposal-draft",
    sourceRevision:3,reviewedBy:author,
    reviewKey:model.key,sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
    selectedIndices:selection.selectedIndices,
    acceptedAddonCodes:selection.acceptedAddonCodes,
    policyRevision:preview.economics.policyRevision,
    policySha256:preview.economics.policySha256,
    reviewedSelectionSha256:preview.reviewedSelectionSha256,
  };
  // PostgreSQL must reproduce *both* exact JS fingerprint byte strings.
  const hashes=JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
      select bm_intake_private.review_workbench_sha256(
        :'p1'::text,:'p2'::text,:'p3'::text) as review_key,
        bm_intake_private.reviewed_selection_sha256(
          :'p4'::jsonb,:'p5'::jsonb,:'p6'::jsonb,:'p3'::text)
          as selection_sha
    ) x;`,{p1:review.sourceSha256,p2:review.candidatesSha256,
      p3:fingerprint,p4:JSON.stringify(review),
      p5:JSON.stringify(selection.selectedIndices),
      p6:JSON.stringify(selection.acceptedAddonCodes)}));
  assert.equal(hashes.review_key,model.key);
  assert.equal(hashes.selection_sha,preview.reviewedSelectionSha256);

  const tryScope=(forged)=>sql(`set role service_role;
    select source_revision from bm_intake_private.commit_typed_note_scope_review(
       :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::text,
       :'p6'::jsonb);`,
    {p1:org,p2:author,p3:sourceId,
      p4:review.sourceSha256,p5:review.candidatesSha256,
      p6:JSON.stringify(forged)});
  assert.throws(()=>tryScope({...scope,reviewKey:"0".repeat(64)}));
  assert.throws(()=>tryScope({...scope,reviewedSelectionSha256:"0".repeat(64)}));
  const unchanged=JSON.parse(sql(`select row_to_json(x) from (
    select revision,scope_review from public.bm_intake_sources
      where organization_id=:'p1'::uuid and id=:'p2'::uuid
    ) x;`,{p1:org,p2:sourceId}));
  assert.equal(unchanged.revision,2);
  assert.equal(unchanged.scope_review,null);

  // A malicious privileged writer can take a syntactically valid revision
  // 2->3 shortcut via an UPDATE. Its selection hashes can be perfectly
  // correct while the chosen service is pending or optional without consent.
  // Read-only recovery must reject that historical policy violation, not
  // legitimize the direct write as an approved human review.
  const forgedSourceId=sql(`set role service_role;
    select source_id from bm_intake_private.create_typed_note(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:author,p3:randomUUID(),p4:original.text});
  assert.equal(sql(`set role service_role;
    select source_revision from bm_intake_private.commit_typed_note_extraction(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::jsonb);`,
    {p1:org,p2:author,p3:forgedSourceId,p4:originalSha,
      p5:JSON.stringify(review)}),"2");
  function forgedScope(indices,acknowledged) {
    const selectedHash=sql(`set role service_role;
      select bm_intake_private.reviewed_selection_sha256(
        :'p1'::jsonb,:'p2'::jsonb,:'p3'::jsonb,:'p4'::text);`,
      {p1:JSON.stringify(review),p2:JSON.stringify(indices),
        p3:JSON.stringify(acknowledged),p4:fingerprint});
    return {...scope,selectedIndices:indices,acceptedAddonCodes:acknowledged,
      reviewedSelectionSha256:selectedHash};
  }
  function inspectForged(scopeInput) {
    const params={p1:org,p2:author,p3:forgedSourceId,
      p4:JSON.stringify(scopeInput),p5:review.sourceSha256,
      p6:review.candidatesSha256,
      p7:scopeInput.reviewedSelectionSha256};
    // With ON_ERROR_STOP, any failed inspection terminates the psql session,
    // automatically rolling back this uncommitted hostile direct UPDATE.
    // First bind the seven values as six plus an isolated SELECT fingerprint
    // literal via the fully bounded SELECT source below.
    const command=`set role service_role;
      begin;
      update public.bm_intake_sources
      set revision=3,scope_review=:'p4'::jsonb
      where organization_id=:'p1'::uuid and id=:'p3'::uuid and revision=2;
      select observation from bm_intake_private.inspect_typed_note_scope_commit(
        :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p5'::text,
        :'p6'::text,:'p7'::text);
      rollback;`;
    // The SQL helper accepts only p1..p9 with explicit UTF-8 text bind args.
    return sql(command,params);
  }
  for (const invalid of [
    forgedScope([1],[]), // pending, unbillable cleaning
    forgedScope([0],[]), // painting optional without consent
  ]) {
    assert.throws(()=>inspectForged(invalid),
      /Persisted scope violates historical company service rules/);
    assert.equal(JSON.parse(sql(`select row_to_json(x) from (
      select revision,scope_review from public.bm_intake_sources
       where organization_id=:'p1'::uuid and id=:'p2'::uuid
     ) x;`,{p1:org,p2:forgedSourceId})).revision,2);
  }
  // The control input still satisfies historical service/consent rules.
  assert.equal(inspectForged(forgedScope([0],["painting"])),
    "matching-scope-at-read");
  assert.equal(JSON.parse(sql(`select row_to_json(x) from (
    select revision,scope_review from public.bm_intake_sources
      where organization_id=:'p1'::uuid and id=:'p2'::uuid
    ) x;`,{p1:org,p2:forgedSourceId})).scope_review,null);

  const inspect=(expectedSelection=scope.reviewedSelectionSha256,
      who=author,tenant=org)=>JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
      select observation,persisted_revision,observed_selection_sha256
      from bm_intake_private.inspect_typed_note_scope_commit(
        :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,
        :'p5'::text,:'p6'::text)
    ) x;`,{p1:tenant,p2:who,p3:sourceId,
      p4:review.sourceSha256,p5:review.candidatesSha256,
      p6:expectedSelection}));
  // Observe the primary before committing; this is a point-in-time read,
  // not proof that the earlier write was rolled back.
  assert.deepEqual(inspect(),{
    observation:"unreviewed-at-read",persisted_revision:2,
    observed_selection_sha256:null,
  });
  const hasBrowserAccess=sql(`select has_function_privilege(
      'authenticated',
      'bm_intake_private.inspect_typed_note_scope_commit(uuid,uuid,uuid,text,text,text)',
      'EXECUTE');`);
  assert.equal(hasBrowserAccess,"f");
  assert.throws(()=>inspect(scope.reviewedSelectionSha256,reviewer));
  assert.throws(()=>inspect(scope.reviewedSelectionSha256,author,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));

  const result=JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
      select source_revision, reviewed_selection_sha256
      from bm_intake_private.commit_typed_note_scope_review(
        :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text,:'p5'::text,
        :'p6'::jsonb)
    ) x;`,{p1:org,p2:author,p3:sourceId,
      p4:review.sourceSha256,p5:review.candidatesSha256,
      p6:JSON.stringify(scope)}));
  assert.equal(result.source_revision,3);
  assert.equal(result.reviewed_selection_sha256,preview.reviewedSelectionSha256);
  const persisted=JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
     select revision,scope_review,review,original_text,
       extraction_audit from public.bm_intake_sources
     where organization_id=:'p1'::uuid and id=:'p2'::uuid
    ) x;`,{p1:org,p2:sourceId}));
  assert.equal(persisted.revision,3);
  assert.deepEqual(persisted.scope_review,scope);
  assert.deepEqual(persisted.review,review);
  assert.equal(persisted.original_text,original.text);
  assert.equal(persisted.extraction_audit.length,1);
  assert.equal(persisted.extraction_audit[0].actorId,author);
  // Exercise the actual JS production-contract adapter against real private
  // PostgreSQL. Each read authorizes the synthetic actor anew and runs ONLY
  // the allowlisted read-only SQL function on isolated primary storage.
  let reviewerActor=author;
  const recoveryCalls=[];
  const recovery=createTrustedTypedNoteScopeRecovery({
    async verifyActiveSession(session){
      if(session!=="bridge-session")throw Error("Synthetic Auth invalid");
      return {userId:reviewerActor};
    },
  },{
    async query(statement,params){
      recoveryCalls.push({statement,params});
      if(!statement.startsWith("select observation, persisted_revision, observed_selection_sha256")
        || !statement.includes("bm_intake_private.inspect_typed_note_scope_commit")
        || statement.includes("commit_typed_note_scope_review")
        || params.length!==6)throw Error("Unexpected recovery SQL statement");
      const binds=Object.fromEntries(params.map((v,i)=>["p"+(i+1),v]));
      const expression=statement.replace(/\$([1-6])(?=::)/g,(_match,n)=>":'p"+n+"'");
      if(expression.includes("$"))throw Error("Unreplaced SQL bind");
      const line=sql("set role service_role; select row_to_json(x) from ("+
        expression+") x;",binds);
      return {rows:line?[JSON.parse(line)]:[]};
    },
  });
  const selector={session:"bridge-session",organizationId:org,sourceId,
    sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
    reviewedSelectionSha256:scope.reviewedSelectionSha256};
  assert.equal((await recovery.reconcile(selector)).state,"matching-scope-at-read");
  assert.equal(recoveryCalls.length,2);
  assert.deepEqual(recoveryCalls[0].params,[
    org,author,sourceId,review.sourceSha256,review.candidatesSha256,
    scope.reviewedSelectionSha256]);
  assert.equal((await recovery.reconcile({
    ...selector,reviewedSelectionSha256:"f".repeat(64),
  })).state,"different-scope-at-read");
  assert.equal(recoveryCalls.length,4);
  reviewerActor=reviewer;
  await assert.rejects(recovery.reconcile(selector));
  reviewerActor=author;
  // Model a lost acknowledgement: two fresh read-only observations agree
  // on the persisted matching draft. Neither performs another CAS.
  const proof1=inspect(),proof2=inspect();
  assert.deepEqual(proof1,proof2);
  assert.deepEqual(proof1,{
    observation:"matching-scope-at-read",persisted_revision:3,
    observed_selection_sha256:scope.reviewedSelectionSha256,
  });
  assert.equal(inspect("f".repeat(64)).observation,"different-scope-at-read");

  // A newer approved ratecard makes the historical matching review STALE,
  // even though the immutable evidence remains valid. No authorization
  // to send or price against this obsolete policy can be inferred.
  const successor={...policy,revision:2,pricing:{
    ...policy.pricing,policyId:"synthetic-bridge-v2",
    services:{...policy.pricing.services,painting:{
      ...policy.pricing.services.painting,rateCents:9000}},
  }};
  const nextDraft=submitPolicyDraft(approved,{organizationId:org,
    submittedBy:author,policy:successor,expectedRevision:1,
    expectedSha256:fingerprint});
  const nextApproved=reviewPolicyDraft(nextDraft,{organizationId:org,
    reviewedBy:reviewer,decision:"approve",expectedRevision:2,
    expectedSha256:nextDraft.revisions[1].policySha256});
  const nextPolicy=readActivePolicy(nextApproved,org);
  sql(`set role service_role;
    select bm_intake_private.ci_stage_approved_policy(
      :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,:'p4'::text);`,
    {p1:org,p2:author,p3:reviewer,p4:canonicalCompanyPolicyText(nextPolicy)});
  const activatedNext=JSON.parse(sql(`set role service_role;
    select row_to_json(x) from (
      select activated_revision,activated_sha256
      from bm_intake_private.activate_scope_policy(
        :'p1'::uuid,:'p2'::uuid,:'p3'::uuid,2,:'p4'::text)
    ) x;`,{p1:org,p2:author,p3:reviewer,
       p4:canonicalCompanyPolicyText(nextPolicy)}));
  assert.equal(activatedNext.activated_revision,2);
  assert.equal(activatedNext.activated_sha256,
    companyPolicySha256(nextPolicy));
  assert.deepEqual(inspect(),{
    observation:"matching-stale-policy-at-read",persisted_revision:3,
    observed_selection_sha256:scope.reviewedSelectionSha256,
  });
  assert.equal((await recovery.reconcile(selector)).state,
    "matching-stale-policy-at-read");
  // Membership revocation must invalidate even read-only reconciliation.
  sql(`delete from public.bm_memberships
     where organization_id=:'p1'::uuid and user_id=:'p2'::uuid;`,
    {p1:org,p2:author});
  assert.throws(()=>inspect());
  await assert.rejects(recovery.reconcile(selector));
  assert.equal(Object.hasOwn(result,"approved"),false);
  assert.equal(Object.hasOwn(result,"quoteTotalCents"),false);
});
