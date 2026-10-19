import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { VersionedEconomicsPolicy } from "./company-economics.ts";
import { companyPolicySha256 } from "./company-policy-fingerprint.ts";
import { buildReviewWorkbench } from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";
import { previewReviewedEconomics } from "./intake-quote-preview.ts";
import { verifyTypedNoteSourceRecord,
  type TypedNoteSourceRecord } from "./tenant-typed-note-source.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const SOURCE = `select record from bm_intake_private.read_typed_note_for_extraction(
  $1::uuid,$2::uuid,$3::uuid)`;
const POLICY = `select h.revision,h.policy_sha256,v.policy,
  v.submitted_by::text as submitted_by,v.reviewed_by::text as reviewed_by
  from bm_intake_private.active_policy_heads h
  join bm_intake_private.approved_policy_versions v
    on v.organization_id=h.organization_id and v.revision=h.revision
    and v.policy_sha256=h.policy_sha256
  join public.bm_memberships m
    on m.organization_id=h.organization_id and m.user_id=$2::uuid
    and m.member_role in ('owner','operator','contractor')
  where h.organization_id=$1::uuid
  for share of h,v,m`;
const COMMIT = `select source_revision, reviewed_selection_sha256
  from bm_intake_private.commit_typed_note_scope_review(
    $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::jsonb)`;

type Selector = {
  session: unknown;
  organizationId: string;
  sourceId: string;
};
type Request = Selector & {
  reviewKey: string;
  selectedIndices: number[];
  acceptedAddonCodes: string[];
};

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value,key));
}
function digest(text: string): string {
  return createHash("sha256").update(text,"utf8").digest("hex");
}
function validateSelector(input: Selector): void {
  if (!exact(input,["session","organizationId","sourceId"])
    || input.session===null || input.session===undefined
    || typeof input.organizationId!=="string" || !UUID.test(input.organizationId)
    || typeof input.sourceId!=="string" || !UUID.test(input.sourceId)) {
    throw new TypeError("Invalid trusted typed-note workbench selector");
  }
}

function validate(input: Request): void {
  if (!exact(input,["session","organizationId","sourceId","reviewKey",
    "selectedIndices","acceptedAddonCodes"])
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
    || typeof input.sourceId !== "string" || !UUID.test(input.sourceId)
    || typeof input.reviewKey !== "string" || !SHA.test(input.reviewKey)
    || !Array.isArray(input.selectedIndices) || input.selectedIndices.length<1
    || input.selectedIndices.length>50
    || input.selectedIndices.some((v,i) => !Number.isSafeInteger(v)
      || v<0 || v>100000 || (i>0 && v<=input.selectedIndices[i-1]))
    || !Array.isArray(input.acceptedAddonCodes)
    || input.acceptedAddonCodes.length>50
    || input.acceptedAddonCodes.some(v=>typeof v!=="string"
      || !/^[a-z][a-z0-9_-]{0,63}$/.test(v))
    || new Set(input.acceptedAddonCodes).size!==input.acceptedAddonCodes.length) {
    throw new TypeError("Invalid internal typed-note scope selection");
  }
}

/** Observations are read-only, point-in-time and never approve or retry a CAS. */
export type ScopeReadOnlyReconciliation =
  | { state:"matching-scope-at-read"; organizationId:string; sourceId:string;
      revision:3; reviewedSelectionSha256:string }
  | { state:"unreviewed-at-read" | "changed-during-read"
      | "different-scope-at-read" | "policy-changed-at-read";
      organizationId:string; sourceId:string };

/**
 * STAGED INTERNAL PORT. Inputs never contain actor IDs, prices or policy JSON.
 * Auth must verify a real non-revoked session on every call; the driver must
 * be a privileged primary PostgreSQL connection, NOT browser/PostgREST.
 * No deployment, production provider or public route is provided.
 */
export function createTrustedTypedNoteScopeCommit(
  auth: ActiveSessionVerifier, db: PrivateIntakeDatabase,
) {
  async function actor(session: unknown): Promise<string> {
    const identity=await auth.verifyActiveSession(session);
    if (!exact(identity,["userId"]) || typeof identity.userId!=="string"
      || !UUID.test(identity.userId)) {
      throw new Error("Fresh authenticated scope reviewer required");
    }
    return identity.userId;
  }
  async function source(input: Selector, creator: string): Promise<TypedNoteSourceRecord> {
    if (await actor(input.session)!==creator) {
      throw new Error("Scope reviewer identity changed");
    }
    const response=await db.query(SOURCE,[
      input.organizationId,creator,input.sourceId,
    ]);
    if (!response || !Array.isArray(response.rows)
      || response.rows.length!==1 || !exact(response.rows[0],["record"])) {
      throw new Error("Creator-owned scope source unavailable");
    }
    const record=response.rows[0].record as TypedNoteSourceRecord;
    if (!record || !record.original || typeof record.original.text!=="string"
      || !record.creationAudit || typeof record.creationAudit.requestId!=="string") {
      throw new Error("Invalid private original source record");
    }
    verifyTypedNoteSourceRecord(record,{
      organizationId:input.organizationId,
      requestId:record.creationAudit.requestId,text:record.original.text,
    },digest(record.original.text),creator);
    if (record.sourceId!==input.sourceId || record.organizationId!==input.organizationId) {
      throw new Error("Private source identifier mismatch");
    }
    return record;
  }
  async function activePolicy(
    input: Selector, creator: string,
  ): Promise<{revision:number; sha:string; policy:VersionedEconomicsPolicy}> {
    if (await actor(input.session)!==creator) {
      throw new Error("Scope reviewer identity changed");
    }
    // The privileged service role bypasses RLS. Enforce current tenant
    // membership in THIS policy query (including the final post-CAS read),
    // not just in an earlier source read or a cached Auth identity.
    const response=await db.query(POLICY,[input.organizationId,creator]);
    if (!response || !Array.isArray(response.rows)
      || response.rows.length!==1
      || !exact(response.rows[0],[
        "revision","policy_sha256","policy","submitted_by","reviewed_by"])) {
      throw new Error("No unambiguous approved current policy");
    }
    const row=response.rows[0];
    if (!Number.isSafeInteger(row.revision) || (row.revision as number)<1
      || (row.revision as number)>1000000
      || typeof row.policy_sha256!=="string" || !SHA.test(row.policy_sha256)
      || typeof row.submitted_by!=="string" || !UUID.test(row.submitted_by)
      || typeof row.reviewed_by!=="string" || !UUID.test(row.reviewed_by)
      || row.submitted_by===row.reviewed_by
      || !row.policy || typeof row.policy!=="object" || Array.isArray(row.policy)) {
      throw new Error("Invalid private approved policy record");
    }
    const policy=row.policy as VersionedEconomicsPolicy;
    if (policy.revision!==row.revision
      || companyPolicySha256(policy)!==row.policy_sha256) {
      throw new Error("Approved policy content and canonical SHA mismatch");
    }
    return {revision:row.revision as number,sha:row.policy_sha256 as string,policy};
  }

  function awaitingReview(record: TypedNoteSourceRecord):void {
    if (record.revision!==2 || !record.review || record.scopeReview!==null) {
      throw new Error("Scope source is not awaiting human review");
    }
  }
  async function stable(
    input: Selector, creator: string, original: TypedNoteSourceRecord,
    policy: {revision:number;sha:string},
  ):Promise<void> {
    // Two separately authorized PRIMARY reads recheck creator membership,
    // original/extraction evidence and company-owned policy head.
    const after=await source(input,creator);
    if (!isDeepStrictEqual(after,original)) {
      throw new Error("Intake evidence changed during private preview; refresh");
    }
    const latest=await activePolicy(input,creator);
    if (latest.revision!==policy.revision || latest.sha!==policy.sha) {
      throw new Error("Approved company policy changed during private preview; refresh");
    }
  }

  // Rebuild canonical reviewed economics from server-owned evidence and the
  // active, independently approved company ratecard. Never trust saved prices.
  function checkedScope(
    record: TypedNoteSourceRecord,
    active: {revision:number;sha:string;policy:VersionedEconomicsPolicy},
    creator: string,
    requested: Pick<Request,"reviewKey"|"selectedIndices"|"acceptedAddonCodes">,
  ) {
    if (!record.review) throw new Error("Missing stored extraction review");
    const model=buildReviewWorkbench(record.original,record.review,active.policy);
    if (model.key!==requested.reviewKey) {
      throw new Error("Scope or approved company policy changed; refresh");
    }
    const selection=prepareReviewPreviewRequest(model,{
      key:model.key,selectedIndices:requested.selectedIndices,
      acceptedAddonCodes:requested.acceptedAddonCodes,
    });
    const preview=previewReviewedEconomics(record.original,record.review,
      selection.selectedIndices,active.policy,selection.acceptedAddonCodes);
    if (preview.economics.policySha256!==active.sha
      || preview.economics.policyRevision!==active.revision) {
      throw new Error("Approved policy fingerprint differs from scope preview");
    }
    const expected={
      state:"reviewed-for-proposal-draft" as const,sourceRevision:3,
      reviewedBy:creator,reviewKey:model.key,
      sourceSha256:record.review.sourceSha256,
      candidatesSha256:record.review.candidatesSha256,
      selectedIndices:selection.selectedIndices,
      acceptedAddonCodes:selection.acceptedAddonCodes,
      policyRevision:active.revision,policySha256:active.sha,
      reviewedSelectionSha256:preview.reviewedSelectionSha256,
    };
    return {expected,preview};
  }

  return {
    /** Source-backed, read-only, currently authorized review workbench. */
    async readWorkbench(input: Selector) {
      validateSelector(input);
      const creator=await actor(input.session);
      const record=await source(input,creator);
      awaitingReview(record);
      const active=await activePolicy(input,creator);
      const model=buildReviewWorkbench(record.original,record.review!,active.policy);
      await stable(input,creator,record,active);
      return {state:"requires-human-service-review" as const,
        sourceId:input.sourceId,organizationId:input.organizationId,
        sourceRevision:2 as const,model};
    },

    /** Server-calculated, non-sendable preview: never a quote or approval. */
    async preview(input: Request) {
      validate(input);
      const creator=await actor(input.session);
      const record=await source(input,creator);
      awaitingReview(record);
      const active=await activePolicy(input,creator);
      const model=buildReviewWorkbench(record.original,record.review!,active.policy);
      if(model.key!==input.reviewKey) {
        throw new Error("Scope or approved company policy changed; refresh");
      }
      const selection=prepareReviewPreviewRequest(model,{
        key:input.reviewKey,selectedIndices:input.selectedIndices,
        acceptedAddonCodes:input.acceptedAddonCodes,
      });
      const preview=previewReviewedEconomics(record.original,record.review!,
        selection.selectedIndices,active.policy,selection.acceptedAddonCodes);
      if(preview.economics.policySha256!==active.sha
        || preview.economics.policyRevision!==active.revision) {
        throw new Error("Approved policy fingerprint differs from scope preview");
      }
      await stable(input,creator,record,active);
      return {...preview,reviewKey:model.key,sourceId:input.sourceId};
    },

    /**
     * Internal read-only handoff to a later proposal DRAFT step.
     * Caller supplies only a session and tenant-owned source ID: selection,
     * actor, current ratecard and all money come from private primary records.
     * This is NOT quote, operator/contractor approval, or permission to send.
     */
    async readReviewedDraft(input: Selector) {
      validateSelector(input);
      const creator=await actor(input.session);
      const record=await source(input,creator);
      if (record.revision!==3 || !record.review || !record.scopeReview
        || record.scopeReview.reviewedBy!==creator) {
        throw new Error("No creator-owned, persisted reviewed scope available");
      }
      const active=await activePolicy(input,creator);
      const saved=record.scopeReview;
      if (saved.policyRevision!==active.revision || saved.policySha256!==active.sha) {
        throw new Error("Reviewed scope policy superseded; renewed review required");
      }
      const {expected,preview}=checkedScope(record,active,creator,{
        reviewKey:saved.reviewKey,selectedIndices:saved.selectedIndices,
        acceptedAddonCodes:saved.acceptedAddonCodes,
      });
      if (!isDeepStrictEqual(saved,expected)) {
        throw new Error("Persisted reviewed scope does not match approved economics");
      }
      await stable(input,creator,record,active);
      return {state:"internal-reviewed-scope-only" as const,
        organizationId:input.organizationId,sourceId:input.sourceId,
        sourceRevision:3 as const,reviewedBy:creator,
        reviewedSelectionSha256:saved.reviewedSelectionSha256,preview};
    },

    /**
     * Recover an uncertain 2->3 scope CAS using two fresh creator-owned
     * primary source AND policy observations. No SQL mutations, no retries.
     * Even a matching snapshot does not prove which attempt wrote it, and
     * an unreviewed snapshot does not prove the earlier write rolled back.
     */
    async reconcile(input: Request): Promise<ScopeReadOnlyReconciliation> {
      validate(input);
      const creator=await actor(input.session);
      const first=await source(input,creator);
      const firstPolicy=await activePolicy(input,creator);
      const second=await source(input,creator);
      const secondPolicy=await activePolicy(input,creator);
      const selector={organizationId:input.organizationId,sourceId:input.sourceId};
      if (!isDeepStrictEqual(first,second)
        || firstPolicy.revision!==secondPolicy.revision
        || firstPolicy.sha!==secondPolicy.sha) {
        return {...selector,state:"changed-during-read"};
      }
      // A revision-3 snapshot is tied to a particular approved ratecard;
      // distinguish that from an invalid selection against a still-current one.
      if (second.revision===3 && second.scopeReview
        && (second.scopeReview.policyRevision!==secondPolicy.revision
          || second.scopeReview.policySha256!==secondPolicy.sha)) {
        return {...selector,state:"policy-changed-at-read"};
      }
      if (![2,3].includes(second.revision)) {
        return {...selector,state:"different-scope-at-read"};
      }
      const model=buildReviewWorkbench(second.original,second.review!,secondPolicy.policy);
      if (model.key!==input.reviewKey) {
        return {...selector,state:"different-scope-at-read"};
      }
      // The review key binds evidence and policy, NOT a user's selection.
      // Validate every selected service, optional acknowledgement, and
      // pricing fingerprint even when no scope CAS is observed (revision 2).
      // Otherwise an invalid selection could be called "unreviewed" merely
      // because the key matched, misleading an ambiguous-write investigation.
      let expected: NonNullable<TypedNoteSourceRecord["scopeReview"]>;
      try {
        ({expected}=checkedScope(second,secondPolicy,creator,input));
      } catch {
        return {...selector,state:"different-scope-at-read"};
      }
      if (second.revision===2) {
        return {...selector,state:"unreviewed-at-read"};
      }
      if (!second.scopeReview) {
        return {...selector,state:"different-scope-at-read"};
      }
      if (!isDeepStrictEqual(second.scopeReview,expected)) {
        return {...selector,state:"different-scope-at-read"};
      }
      return {...selector,state:"matching-scope-at-read",revision:3,
        reviewedSelectionSha256:expected.reviewedSelectionSha256};
    },

    /**
     * One and only one private 2->3 SQL CAS. An exception after attempting
     * COMMIT is INDETERMINATE, never proof of rollback or retry permission.
     * The operation returns only non-sendable 'reviewed-for-proposal-draft'.
     */
    async commit(input: Request): Promise<{
      state:"reviewed-for-proposal-draft"; sourceId:string;
      revision:3; reviewedSelectionSha256:string; reviewedBy:string;
    }> {
      validate(input);
      const creator=await actor(input.session);
      const record=await source(input,creator);
      if (record.revision!==2 || !record.review || record.scopeReview!==null) {
        throw new Error("Scope source is not awaiting human review");
      }
      const active=await activePolicy(input,creator);
      const model=buildReviewWorkbench(record.original,record.review,active.policy);
      if (model.key!==input.reviewKey) {
        throw new Error("Scope or approved company policy changed; refresh");
      }
      const selection=prepareReviewPreviewRequest(model,{
        key:model.key,
        selectedIndices:input.selectedIndices,
        acceptedAddonCodes:input.acceptedAddonCodes,
      });
      const preview=previewReviewedEconomics(record.original,record.review,
        selection.selectedIndices,active.policy,selection.acceptedAddonCodes);
      if (preview.economics.policySha256!==active.sha
        || preview.economics.policyRevision!==active.revision) {
        throw new Error("Approved policy fingerprint differs from scope preview");
      }
      // Auth and private SQL independently check current membership before
      // source existence, lock the source and ACTIVE approved policy row.
      if (await actor(input.session)!==creator) {
        throw new Error("Scope reviewer identity changed before commit");
      }
      const scope={
        state:"reviewed-for-proposal-draft" as const,
        sourceRevision:3,reviewedBy:creator,reviewKey:model.key,
        sourceSha256:record.review.sourceSha256,
        candidatesSha256:record.review.candidatesSha256,
        selectedIndices:selection.selectedIndices,
        acceptedAddonCodes:selection.acceptedAddonCodes,
        policyRevision:active.revision,policySha256:active.sha,
        reviewedSelectionSha256:preview.reviewedSelectionSha256,
      };
      const result=await db.query(COMMIT,[
        input.organizationId,creator,input.sourceId,
        scope.sourceSha256,scope.candidatesSha256,JSON.stringify(scope),
      ]);
      if (!result || !Array.isArray(result.rows) || result.rows.length!==1
        || !exact(result.rows[0],[
          "source_revision","reviewed_selection_sha256"])
        || result.rows[0].source_revision!==3
        || result.rows[0].reviewed_selection_sha256!==scope.reviewedSelectionSha256) {
        throw new Error("Human scope CAS result indeterminate; inspect, never retry");
      }
      // Freshly authorized primary read-back confirms the complete record.
      const after=await source(input,creator);
      if (after.revision!==3 || !isDeepStrictEqual(after.scopeReview,scope)
        || !isDeepStrictEqual(after.original,record.original)
        || !isDeepStrictEqual(after.review,record.review)
        || !isDeepStrictEqual(after.extractionAudit,record.extractionAudit)
        || !isDeepStrictEqual(after.creationAudit,record.creationAudit)) {
        throw new Error("Scope read-back indeterminate; inspect, never retry");
      }
      const latest=await activePolicy(input,creator);
      if (latest.revision!==active.revision || latest.sha!==active.sha) {
        throw new Error("Approved policy changed after scope commit; inspect");
      }
      return {
        state:"reviewed-for-proposal-draft",sourceId:input.sourceId,
        revision:3,reviewedSelectionSha256:scope.reviewedSelectionSha256,
        reviewedBy:creator,
      };
    },
  };
}
