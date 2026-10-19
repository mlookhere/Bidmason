import { readActivePolicy } from "./company-policy-revisions.ts";
import { canonicalCompanyPolicyText, companyPolicySha256 }
  from "./company-policy-fingerprint.ts";
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
const ACTIVATE=`select activated_revision, activated_sha256
  from bm_intake_private.activate_scope_policy(
    $1::uuid,$2::uuid,$3::uuid,$4::integer,$5::text)`;

function exact(value: unknown, names: readonly string[]): value is Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length!==names.length)return false;
  return names.every(name=>{
    const d=Object.getOwnPropertyDescriptor(value,name);
    return d?.enumerable===true && Object.hasOwn(d,"value");
  });
}
function parseHead(value: unknown): {revision:number;sha:string;
  canonical:string;submittedBy:string;reviewedBy:string} {
  if (!exact(value,["revision","policy_sha256","policy",
    "submitted_by","reviewed_by"])
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number)<1 || (value.revision as number)>1000000
    || typeof value.policy_sha256!=="string" || !SHA.test(value.policy_sha256)
    || typeof value.submitted_by!=="string" || !UUID.test(value.submitted_by)
    || typeof value.reviewed_by!=="string" || !UUID.test(value.reviewed_by)
    || value.submitted_by===value.reviewed_by
    || !value.policy || typeof value.policy!=="object") {
    throw new Error("Private approved-policy head is malformed");
  }
  const canonical=canonicalCompanyPolicyText(value.policy as Parameters<
    typeof canonicalCompanyPolicyText>[0]);
  if (companyPolicySha256(value.policy as Parameters<
    typeof companyPolicySha256>[0])!==value.policy_sha256
    || (value.policy as {revision?:unknown}).revision!==value.revision) {
    throw new Error("Approved-policy head SHA/revision disagrees with content");
  }
  return {revision:value.revision as number,sha:value.policy_sha256 as string,
    canonical,submittedBy:value.submitted_by as string,
    reviewedBy:value.reviewed_by as string};
}

/**
 * STAGING SERVER CONTRACT. The policy store must already durably record a
 * separate human submit and review; this adapter does NOT invent either
 * approval action. Fresh Auth and service-role PRIMARY postgres are injected,
 * never browser controlled. No live Supabase adapter or route is supplied.
 */
export function createTrustedCompanyPolicyActivation(
  auth:ActiveSessionVerifier, store:TrustedPolicyStore,
  database:PrivateIntakeDatabase,
) {
  async function actor(session:unknown):Promise<string> {
    const identity=await auth.verifyActiveSession(session);
    if (!exact(identity,["userId"]) || typeof identity.userId!=="string"
      || !UUID.test(identity.userId)) {
      throw new Error("Fresh active reviewer identity required");
    }
    return identity.userId;
  }
  async function history(organizationId:string,session:unknown,
    reviewer:string) {
    if(await actor(session)!==reviewer)throw new Error("Reviewer session changed");
    const persisted=await store.readAuthorized({organizationId,session});
    if (!persisted || !Array.isArray(persisted.revisions)
      || persisted.revisions.length===0) {
      throw new Error("No durable company policy review is available");
    }
    const policy=readActivePolicy(persisted,organizationId);
    const last=persisted.revisions.at(-1)!;
    if (last.status!=="approved" || last.revision!==persisted.activeRevision
      || last.reviewedBy!==reviewer || last.submittedBy===reviewer
      || last.revision>1000000) {
      throw new Error("Current approval must be by the authenticated distinct reviewer");
    }
    // A rejected submission retains its immutable revision number.
    // Prior active means the last APPROVED revision, not the immediately
    // preceding submitted revision. Every intervening submission must have
    // been explicitly rejected; SQL independently verifies these events.
    const previous=persisted.revisions.slice(0,-1).findLast(
      revision=>revision.status==="approved");
    const gapStart=(previous?.revision??0)+1;
    if (persisted.revisions.slice(gapStart-1,-1).some(
      revision=>revision.status!=="rejected")) {
      throw new Error("Unreviewed or approved intermediate policy revisions");
    }
    const canonical=canonicalCompanyPolicyText(policy);
    const sha=companyPolicySha256(policy);
    if (sha!==last.policySha256)throw new Error("Approved revision digest changed");
    return {canonical,sha,revision:last.revision,
      submittedBy:last.submittedBy,reviewedBy:reviewer,
      previous:previous
        ? {revision:previous.revision,sha:previous.policySha256}:null};
  }
  async function head(organizationId:string,reviewer:string) {
    const result=await database.query(HEAD,[organizationId,reviewer]);
    if(!result || !Array.isArray(result.rows) || result.rows.length>1) {
      throw new Error("Ambiguous private approved-policy head");
    }
    return result.rows.length===0 ? null : parseHead(result.rows[0]);
  }
  return {
    /**
     * No client-provided actor, policy JSON, SHA, rates or revision.
     * One private activation attempt, never a blind retry after an error.
     * A successful response is valid only after independent authorized
     * history and current PostgreSQL read-back agree.
     */
    async activate(input:{organizationId:string;reviewerSession:unknown}):
      Promise<{state:"activated-for-internal-review";organizationId:string;
        revision:number;policySha256:string}> {
      if (!exact(input,["organizationId","reviewerSession"])
        || typeof input.organizationId!=="string"
        || !UUID.test(input.organizationId)
        || input.reviewerSession===null || input.reviewerSession===undefined) {
        throw new TypeError("Invalid private policy activation selector");
      }
      // Preserve the original caller intention throughout Auth, primary
      // history, SQL activation and the post-write verification. Never retry.
      const target={organizationId:input.organizationId,
        reviewerSession:input.reviewerSession};
      const reviewer=await actor(target.reviewerSession);
      const expected=await history(target.organizationId,target.reviewerSession,reviewer);
      if (await actor(target.reviewerSession)!==reviewer) {
        throw new Error("Reviewer identity changed before policy head read");
      }
      const before=await head(target.organizationId,reviewer);
      if ((expected.previous===null && before!==null)
        || (expected.previous!==null
          && (!before || before.revision!==expected.previous.revision
            || before.sha!==expected.previous.sha))) {
        throw new Error("Stale company policy head; inspect, do not retry");
      }
      if (await actor(target.reviewerSession)!==reviewer) {
        throw new Error("Reviewer identity changed before policy activation");
      }
      // This SQL independently rechecks and locks CURRENT tenant membership
      // for both actors and enforces exact next revision before writing.
      const response=await database.query(ACTIVATE,[
        target.organizationId,expected.submittedBy,reviewer,
        String(expected.revision),expected.canonical,
      ]);
      if(!response || !Array.isArray(response.rows)
        || response.rows.length!==1
        || !exact(response.rows[0],["activated_revision","activated_sha256"])
        || response.rows[0].activated_revision!==expected.revision
        || response.rows[0].activated_sha256!==expected.sha) {
        throw new Error("Policy activation outcome indeterminate; never retry");
      }
      const latest=await history(target.organizationId,target.reviewerSession,reviewer);
      if(latest.revision!==expected.revision || latest.sha!==expected.sha
        || latest.canonical!==expected.canonical
        || latest.submittedBy!==expected.submittedBy) {
        throw new Error("Durable approval changed after activation; inspect");
      }
      if(await actor(target.reviewerSession)!==reviewer) {
        throw new Error("Reviewer identity changed after activation");
      }
      const after=await head(target.organizationId,reviewer);
      if(!after || after.revision!==expected.revision || after.sha!==expected.sha
        || after.canonical!==expected.canonical
        || after.submittedBy!==expected.submittedBy
        || after.reviewedBy!==reviewer) {
        throw new Error("Private policy activation read-back indeterminate; inspect");
      }
      return {state:"activated-for-internal-review",
        organizationId:target.organizationId,
        revision:expected.revision,policySha256:expected.sha};
    },
  };
}
