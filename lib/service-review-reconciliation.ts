import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { readActivePolicy } from "./company-policy-revisions.ts";
import { hasCorrectionLifecycle, serviceReviewFingerprint,
  type TrustedServiceReviewStore, type ServiceReviewCommitRequest,
  type TenantServiceReviewRecord } from "./tenant-service-review.ts";
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

/** Reject hidden/forged directives and getters before inspecting authority IDs. */
function exactFields(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}
function canonicalArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > max
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true
      || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}

function checkRequest(request: ServiceReviewCommitRequest): void {
  if (!exactFields(request, ["organizationId","sourceId","expectedRevision",
      "expectedSnapshotSha256","reviewKey","selectedIndices","acceptedAddonCodes"])
    || typeof request.organizationId !== "string" || !UUID.test(request.organizationId)
    || typeof request.sourceId !== "string" || !UUID.test(request.sourceId)
    || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string" || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.reviewKey !== "string" || !HASH.test(request.reviewKey)
    || !canonicalArray(request.selectedIndices, 50) || request.selectedIndices.length < 1
    || request.selectedIndices.some(n => !Number.isSafeInteger(n) || n < 0 || n >= 50)
    || new Set(request.selectedIndices).size !== request.selectedIndices.length
    || !canonicalArray(request.acceptedAddonCodes, 50)
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
  // Recovery is read-only. Freeze the exact original intent before the first
  // asynchronous authorization, so a caller cannot retarget both readbacks.
  const target: ServiceReviewCommitRequest = {
    organizationId: request.organizationId, sourceId: request.sourceId,
    expectedRevision: request.expectedRevision,
    expectedSnapshotSha256: request.expectedSnapshotSha256,
    reviewKey: request.reviewKey,
    selectedIndices: [...request.selectedIndices],
    acceptedAddonCodes: [...request.acceptedAddonCodes],
  };
  const read = () => sourceStore.readAuthorized({
    session, organizationId:target.organizationId, sourceId:target.sourceId,
  });
  const readPolicy = () => policyStore.readAuthorized({
    session, organizationId:target.organizationId,
  });
  const current = await read();
  checkAuthorizedRecord(current, request);
  // An original review can never reconcile a corrected extraction lifecycle,
  // including a mistakenly restored old scope. This is conflicting evidence.
  if (hasCorrectionLifecycle(current)) {
    return {state:"conflict",sourceId:target.sourceId};
  }
  // Reconstruct the original revision without erasing the persisted source or
  // extraction audit. A changed original is never counted as our commit.
  const before: TenantServiceReviewRecord = {
    ...current, revision:target.expectedRevision, scopeReview:null,
  };
  if (serviceReviewFingerprint(before) !== target.expectedSnapshotSha256) {
    return {state:"conflict",sourceId:target.sourceId};
  }
  const history = await readPolicy();
  if (!history) throw new Error("Authorized approved company policy unavailable");
  // Validates the entire immutable revision history and active pointer.
  const activePolicy = readActivePolicy(history, target.organizationId);
  let classification: ServiceReviewReconciliation;
  if (current.revision === target.expectedRevision && current.scopeReview === null) {
    // This is not a rollback proof: a slow transaction may still commit.
    classification = {state:"unchanged-at-read",sourceId:target.sourceId};
  } else if (current.revision === target.expectedRevision + 1 && current.scopeReview
    && typeof current.scopeReview.reviewedBy === "string"
    && UUID.test(current.scopeReview.reviewedBy)) {
    const scope = current.scopeReview;
    const prior = history.revisions.find(item =>
      item.revision === scope.policyRevision && item.status === "approved");
    if (!prior) {
      classification = {state:"conflict",sourceId:target.sourceId};
    } else {
      try {
        const historicalPolicy = prior.policy;
        const workbench = buildReviewWorkbench(current.original, current.review!, historicalPolicy);
        if (workbench.key !== target.reviewKey) throw Error("Mismatched review key");
        const checked = prepareReviewPreviewRequest(workbench,{
          key:target.reviewKey, selectedIndices:target.selectedIndices,
          acceptedAddonCodes:target.acceptedAddonCodes,
        });
        const preview = previewReviewedEconomics(current.original, current.review!,
          checked.selectedIndices, historicalPolicy, checked.acceptedAddonCodes);
        const expected = {
          state:"reviewed-for-proposal-draft",
          sourceRevision:current.revision,
          reviewedBy:scope.reviewedBy,
          reviewKey:target.reviewKey,
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
          state:activeKey === target.reviewKey
            ? "confirmed-current-at-read" : "recorded-stale-policy",
          sourceId:target.sourceId, revision:current.revision,
          reviewedBy:scope.reviewedBy, reviewedSelectionSha256:scope.reviewedSelectionSha256,
        };
      } catch {
        classification = {state:"conflict",sourceId:target.sourceId};
      }
    }
  } else {
    classification = {state:"conflict",sourceId:target.sourceId};
  }

  // A second fresh authorized primary read detects intervening changes. Never
  // convert a source race into a confirmation or unchanged/rollback assertion.
  const last = await read();
  checkAuthorizedRecord(last, request);
  if (hasCorrectionLifecycle(last)
    || serviceReviewFingerprint(last) !== serviceReviewFingerprint(current)) {
    return {state:"conflict",sourceId:target.sourceId};
  }
  // Same policy check after evidence read. A mid-flight switch must never
  // produce 'confirmed-current-at-read' based on the obsolete active policy.
  const lastHistory = await readPolicy();
  if (!lastHistory) throw new Error("Authorized approved company policy unavailable");
  const lastActive = readActivePolicy(lastHistory,target.organizationId);
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
