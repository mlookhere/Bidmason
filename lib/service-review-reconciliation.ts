import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { readActivePolicy } from "./company-policy-revisions.ts";
import type { TrustedServiceReviewStore, ServiceReviewCommitRequest,
  TenantServiceReviewRecord } from "./tenant-service-review.ts";
import { buildReviewWorkbench } from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";
import { previewReviewedEconomics } from "./intake-quote-preview.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export type ServiceReviewReconciliation =
  | { state: "unchanged-at-read"; sourceId: string }
  | { state: "confirmed-current-at-read"; sourceId: string; revision: number;
      reviewedBy: string; reviewedSelectionSha256: string }
  | { state: "recorded-stale-policy"; sourceId: string; revision: number;
      reviewedBy: string; reviewedSelectionSha256: string }
  | { state: "conflict"; sourceId: string };

function sha(record: TenantServiceReviewRecord): string {
  // Keep the original source CAS contract's exact serialized field order.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review, record.extractionAudit, record.scopeReview,
  ])).digest("hex");
}

function checkRequest(request: ServiceReviewCommitRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).length !== 7
    || ["organizationId","sourceId","expectedRevision","expectedSnapshotSha256",
      "reviewKey","selectedIndices","acceptedAddonCodes"]
      .some(k => !Object.hasOwn(request, k))
    || typeof request.organizationId !== "string" || !UUID.test(request.organizationId)
    || typeof request.sourceId !== "string" || !UUID.test(request.sourceId)
    || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string" || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.reviewKey !== "string" || !HASH.test(request.reviewKey)
    || !Array.isArray(request.selectedIndices) || request.selectedIndices.length < 1
    || request.selectedIndices.length > 50
    || request.selectedIndices.some(n => !Number.isSafeInteger(n) || n < 0 || n >= 50)
    || new Set(request.selectedIndices).size !== request.selectedIndices.length
    || !Array.isArray(request.acceptedAddonCodes) || request.acceptedAddonCodes.length > 50
    || request.acceptedAddonCodes.some(c => typeof c !== "string" || c.length > 64)
    || new Set(request.acceptedAddonCodes).size !== request.acceptedAddonCodes.length) {
    throw new TypeError("Invalid scope reconciliation request");
  }
}

function checkAuthorizedRecord(value: TenantServiceReviewRecord | null,
  request: ServiceReviewCommitRequest): asserts value is TenantServiceReviewRecord {
  if (!value || value.organizationId !== request.organizationId
    || value.sourceId !== request.sourceId || !Number.isSafeInteger(value.revision)
    || value.revision < 1 || !value.original || !value.review
    || !Array.isArray(value.extractionAudit) || value.extractionAudit.length !== 1) {
    throw new Error("Authorized reviewed source missing or malformed");
  }
}

/** Read ONLY. No mutation, retry, commercial approval, or external delivery.
 * Authorization and linearizable/primary reads are duties of the store adapters.
 * A matching review does not prove the original actor was authorized at commit.
 */
export async function reconcileServiceReview(
  sourceStore: Pick<TrustedServiceReviewStore, "readAuthorized">,
  policyStore: Pick<TrustedPolicyStore, "readAuthorized">,
  session: unknown,
  request: ServiceReviewCommitRequest,
): Promise<ServiceReviewReconciliation> {
  checkRequest(request);
  const read = () => sourceStore.readAuthorized({
    session, organizationId:request.organizationId, sourceId:request.sourceId,
  });
  const readPolicy = () => policyStore.readAuthorized({
    session, organizationId:request.organizationId,
  });
  const current = await read();
  checkAuthorizedRecord(current, request);
  // Reconstruct the original revision without erasing the persisted source or
  // extraction audit. A changed original is never counted as our commit.
  const before: TenantServiceReviewRecord = {
    ...current, revision:request.expectedRevision, scopeReview:null,
  };
  if (sha(before) !== request.expectedSnapshotSha256) {
    return {state:"conflict",sourceId:request.sourceId};
  }
  const history = await readPolicy();
  if (!history) throw new Error("Authorized approved company policy unavailable");
  // Validates the entire immutable revision history and active pointer.
  const activePolicy = readActivePolicy(history, request.organizationId);
  let classification: ServiceReviewReconciliation;
  if (current.revision === request.expectedRevision && current.scopeReview === null) {
    // This is not a rollback proof: a slow transaction may still commit.
    classification = {state:"unchanged-at-read",sourceId:request.sourceId};
  } else if (current.revision === request.expectedRevision + 1 && current.scopeReview
    && typeof current.scopeReview.reviewedBy === "string"
    && UUID.test(current.scopeReview.reviewedBy)) {
    const scope = current.scopeReview;
    const prior = history.revisions.find(item =>
      item.revision === scope.policyRevision && item.status === "approved");
    if (!prior) {
      classification = {state:"conflict",sourceId:request.sourceId};
    } else {
      try {
        const historicalPolicy = prior.policy;
        const workbench = buildReviewWorkbench(current.original, current.review!, historicalPolicy);
        if (workbench.key !== request.reviewKey) throw Error("Mismatched review key");
        const checked = prepareReviewPreviewRequest(workbench,{
          key:request.reviewKey, selectedIndices:request.selectedIndices,
          acceptedAddonCodes:request.acceptedAddonCodes,
        });
        const preview = previewReviewedEconomics(current.original, current.review!,
          checked.selectedIndices, historicalPolicy, checked.acceptedAddonCodes);
        const expected = {
          state:"reviewed-for-proposal-draft",
          sourceRevision:current.revision,
          reviewedBy:scope.reviewedBy,
          reviewKey:request.reviewKey,
          sourceSha256:preview.sourceSha256,
          candidatesSha256:preview.candidatesSha256,
          selectedIndices:checked.selectedIndices,
          acceptedAddonCodes:checked.acceptedAddonCodes,
          policyRevision:preview.economics.policyRevision,
          policySha256:preview.economics.policySha256,
          reviewedSelectionSha256:preview.reviewedSelectionSha256,
        };
        if (!isDeepStrictEqual(scope, expected)) throw Error("Mismatched stored scope audit");
        const activeKey = buildReviewWorkbench(current.original,current.review!,activePolicy).key;
        classification = {
          state:activeKey === request.reviewKey
            ? "confirmed-current-at-read" : "recorded-stale-policy",
          sourceId:request.sourceId, revision:current.revision,
          reviewedBy:scope.reviewedBy, reviewedSelectionSha256:scope.reviewedSelectionSha256,
        };
      } catch {
        classification = {state:"conflict",sourceId:request.sourceId};
      }
    }
  } else {
    classification = {state:"conflict",sourceId:request.sourceId};
  }

  // A second fresh authorized primary read detects intervening changes. Never
  // convert a source race into a confirmation or unchanged/rollback assertion.
  const last = await read();
  checkAuthorizedRecord(last, request);
  if (sha(last) !== sha(current)) {
    return {state:"conflict",sourceId:request.sourceId};
  }
  // Same policy check after evidence read. A mid-flight switch must never
  // produce 'confirmed-current-at-read' based on the obsolete active policy.
  const lastHistory = await readPolicy();
  if (!lastHistory) throw new Error("Authorized approved company policy unavailable");
  const lastActive = readActivePolicy(lastHistory,request.organizationId);
  const firstStamp = createHash("sha256").update(JSON.stringify(activePolicy)).digest("hex");
  const lastStamp = createHash("sha256").update(JSON.stringify(lastActive)).digest("hex");
  if (firstStamp !== lastStamp) {
    if (classification.state === "confirmed-current-at-read") {
      return {...classification, state:"recorded-stale-policy"};
    }
    // A policy race must not convert a conflicting write into a valid review.
    return classification;
  }
  return classification;
}
