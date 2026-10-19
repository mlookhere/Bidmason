import { assertValidCompanyPolicyHistory } from "./company-policy-revisions.ts";
import { canonicalCompanyPolicyText, companyPolicySha256 }
  from "./company-policy-fingerprint.ts";
import type { PolicyRevision } from "./company-policy-revisions.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const HEAD=`select h.revision,h.policy_sha256,v.policy,
  v.submitted_by::text as submitted_by,v.reviewed_by::text as reviewed_by
  from bm_intake_private.active_policy_heads h
  join bm_intake_private.approved_policy_versions v
    on v.organization_id=h.organization_id and v.revision=h.revision
    and v.policy_sha256=h.policy_sha256
  join public.bm_memberships m
    on m.organization_id=h.organization_id and m.user_id=$2::uuid
    and m.member_role in ('owner','operator')
  where h.organization_id=$1::uuid
  for share of h,v,m`;
const HISTORICAL=`select v.revision,v.policy_sha256,v.policy,
  v.submitted_by::text as submitted_by,v.reviewed_by::text as reviewed_by
  from bm_intake_private.approved_policy_versions v
  join public.bm_memberships m
    on m.organization_id=v.organization_id and m.user_id=$3::uuid
    and m.member_role in ('owner','operator')
  where v.organization_id=$1::uuid and v.revision=$2::integer
  for share of v,m`;

export type CompanyActivationObservation =
  | {state:"not-active-at-read"|"matching-active-at-read"
      |"historical-superseded-at-read";
      organizationId:string;revision:number;policySha256:string;
      observedHeadRevision:number|null;observedHeadSha256:string|null}
  | {state:"changed-during-read";organizationId:string;revision:number;
      policySha256:string};

type Selector={organizationId:string;reviewerSession:unknown;
  revision:number;policySha256:string};
type Version={revision:number;sha:string;submittedBy:string;
  reviewedBy:string;canonical:string};
type Observation={state:"not-active-at-read"|"matching-active-at-read"
  |"historical-superseded-at-read";head:Version|null};

function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
  return !!value && typeof value==="object" && !Array.isArray(value)
    && Object.keys(value).length===keys.length
    && keys.every(key=>Object.hasOwn(value,key));
}
function version(row:unknown):Version {
  if(!exact(row,["revision","policy_sha256","policy",
    "submitted_by","reviewed_by"])
    || !Number.isSafeInteger(row.revision)
    || (row.revision as number)<1 || (row.revision as number)>1000000
    || typeof row.policy_sha256!=="string" || !SHA.test(row.policy_sha256)
    || typeof row.submitted_by!=="string" || !UUID.test(row.submitted_by)
    || typeof row.reviewed_by!=="string" || !UUID.test(row.reviewed_by)
    || row.submitted_by===row.reviewed_by || !row.policy
    || typeof row.policy!=="object" || Array.isArray(row.policy)) {
    throw new Error("Invalid private activated company policy record");
  }
  const canonical=canonicalCompanyPolicyText(row.policy as Parameters<
    typeof canonicalCompanyPolicyText>[0]);
  if (companyPolicySha256(row.policy as Parameters<
    typeof companyPolicySha256>[0])!==row.policy_sha256
    || (row.policy as {revision?:unknown}).revision!==row.revision) {
    throw new Error("Private activation canonical content disagrees with stored SHA");
  }
  return {revision:row.revision as number,sha:row.policy_sha256 as string,
    submittedBy:row.submitted_by as string,reviewedBy:row.reviewed_by as string,
    canonical};
}
function assertMatching(versionRecord:Version,revision:PolicyRevision):void {
  if(versionRecord.revision!==revision.revision
    || versionRecord.sha!==revision.policySha256
    || versionRecord.canonical!==canonicalCompanyPolicyText(revision.policy)
    || versionRecord.submittedBy!==revision.submittedBy
    || versionRecord.reviewedBy!==revision.reviewedBy) {
    throw new Error("Private activation is inconsistent with durable approval events");
  }
}
function check(input:Selector):void {
  if (!exact(input,["organizationId","reviewerSession","revision","policySha256"])
    || typeof input.organizationId!=="string" || !UUID.test(input.organizationId)
    || input.reviewerSession===null || input.reviewerSession===undefined
    || !Number.isSafeInteger(input.revision)
    || input.revision<1 || input.revision>1000
    || typeof input.policySha256!=="string" || !SHA.test(input.policySha256)) {
    throw new TypeError("Invalid private activation recovery selector");
  }
}

/**
 * STAGED server-only, read-only observation of an earlier activation attempt.
 * It is never a retry permit, an approval, or evidence of customer consent.
 * Reviewer identity comes from the injected ACTIVE session verifier only.
 */
export function createTrustedCompanyPolicyRecovery(
  auth:ActiveSessionVerifier,store:TrustedPolicyStore,
  database:PrivateIntakeDatabase,
) {
  async function actor(session:unknown):Promise<string> {
    const value=await auth.verifyActiveSession(session);
    if(!exact(value,["userId"])||typeof value.userId!=="string"
      || !UUID.test(value.userId)) {
      throw new Error("Fresh active policy recovery reviewer required");
    }
    return value.userId;
  }
  async function one(input:Selector,expectedActor?:string):Promise<{
    actor:string;result:Observation;
  }> {
    const reviewer=await actor(input.reviewerSession);
    if(expectedActor && reviewer!==expectedActor) {
      throw new Error("Policy recovery reviewer changed between observations");
    }
    const persisted=await store.readAuthorized({
      organizationId:input.organizationId,session:input.reviewerSession});
    if(!persisted)throw new Error("No authorized durable policy history");
    assertValidCompanyPolicyHistory(persisted,input.organizationId);
    const wanted=persisted.revisions[input.revision-1];
    if(!wanted || wanted.status!=="approved"
      || wanted.reviewedBy!==reviewer
      || wanted.submittedBy===reviewer
      || wanted.policySha256!==input.policySha256) {
      throw new Error("No approved reviewer-owned policy matches this observation");
    }
    if(await actor(input.reviewerSession)!==reviewer) {
      throw new Error("Policy recovery reviewer changed before primary reads");
    }
    const headResponse=await database.query(HEAD,[input.organizationId,reviewer]);
    if(!headResponse || !Array.isArray(headResponse.rows)
      || headResponse.rows.length>1) {
      throw new Error("Ambiguous private activation head");
    }
    const head=headResponse.rows.length?version(headResponse.rows[0]):null;
    if(head) {
      const headEvent=persisted.revisions[head.revision-1];
      if(!headEvent || headEvent.status!=="approved") {
        throw new Error("Activated head is absent from approved policy history");
      }
      assertMatching(head,headEvent);
    }
    const oldResponse=await database.query(HISTORICAL,[
      input.organizationId,String(input.revision),reviewer,
    ]);
    if(!oldResponse || !Array.isArray(oldResponse.rows)
      || oldResponse.rows.length>1) {
      throw new Error("Ambiguous immutable historical activation");
    }
    const historical=oldResponse.rows.length?version(oldResponse.rows[0]):null;
    if(historical)assertMatching(historical,wanted);
    if(head && head.revision>=input.revision && !historical) {
      throw new Error("Activated head missing its immutable historical approval");
    }
    if(head && head.revision<input.revision && historical
      || !head && historical
      || head && head.revision===input.revision && head.sha!==wanted.policySha256) {
      throw new Error("Contradictory private activation pointer/history");
    }
    if(await actor(input.reviewerSession)!==reviewer) {
      throw new Error("Policy recovery reviewer changed during inspection");
    }
    const state:Observation["state"]=!head||head.revision<input.revision
      ?"not-active-at-read"
      :head.revision===input.revision?"matching-active-at-read"
      :"historical-superseded-at-read";
    return {actor:reviewer,result:{state,head}};
  }
  return {
    /**
     * Two independently authenticated durable-history/primary-DB reads.
     * Different observations mean a race, not a failed or successful CAS.
     * Even matching "not active" is NOT permission to retry an unknown write.
     */
    async reconcile(input:Selector):Promise<CompanyActivationObservation> {
      check(input);
      const first=await one(input);
      const second=await one(input,first.actor);
      const base={organizationId:input.organizationId,
        revision:input.revision,policySha256:input.policySha256};
      if(first.result.state!==second.result.state
        || first.result.head?.revision!==second.result.head?.revision
        || first.result.head?.sha!==second.result.head?.sha) {
        return {...base,state:"changed-during-read"};
      }
      return {...base,state:second.result.state,
        observedHeadRevision:second.result.head?.revision??null,
        observedHeadSha256:second.result.head?.sha??null};
    },
  };
}
