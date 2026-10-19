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

test("real PG activation SHA equals TS approval, preview and reviewed draft",()=>{
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
  assert.equal(Object.hasOwn(result,"approved"),false);
  assert.equal(Object.hasOwn(result,"quoteTotalCents"),false);
});
