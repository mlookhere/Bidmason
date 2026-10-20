import { createHash } from "node:crypto";
import { snapshotInertEvidence, snapshotInertPolicyHistory }
  from "./inert-evidence-graph.ts";
import { isDeepStrictEqual } from "node:util";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { readActivePolicy } from "./company-policy-revisions.ts";
import { hasCorrectionLifecycle,
  type TenantServiceReviewRecord, type TrustedServiceReviewStore }
  from "./tenant-service-review.ts";
import { buildReviewWorkbench } from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";
import { previewReviewedEconomics, type ReviewedEconomicsPreview }
  from "./intake-quote-preview.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type InternalProposalDraftPreview = {
  state: "preview-only";
  purpose: "internal-proposal-draft";
  organizationId: string;
  sourceId: string;
  sourceRevision: number;
  reviewedBy: string;
  draftSnapshotSha256: string;
  preview: ReviewedEconomicsPreview;
};

type Selector = { organizationId: string; sourceId: string };

function snapshotSha(value: TenantServiceReviewRecord): string {
  return createHash("sha256").update(JSON.stringify([
    value.organizationId, value.sourceId, value.revision,
    value.original, value.review, value.extractionAudit, value.scopeReview,
    Object.getOwnPropertyDescriptor(value, "pendingCorrection")?.value ?? null,
    Object.getOwnPropertyDescriptor(value, "activatedCorrection")?.value ?? null,
    Object.getOwnPropertyDescriptor(value, "correctedScopeReview")?.value ?? null,
  ])).digest("hex");
}

function checkSelector(value: Selector): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== 2
    || ["organizationId", "sourceId"].some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value");
    })
    || typeof value.organizationId !== "string" || !UUID.test(value.organizationId)
    || typeof value.sourceId !== "string" || !UUID.test(value.sourceId)) {
    throw new TypeError("Invalid internal proposal draft selector");
  }
}

function checkStoredReview(
  value: TenantServiceReviewRecord | null,
  selector: Selector,
): asserts value is TenantServiceReviewRecord {
  if (!value || value.organizationId !== selector.organizationId
    || value.sourceId !== selector.sourceId
    || !Number.isSafeInteger(value.revision) || value.revision < 3
    || !value.original || !value.review || value.review.state !== "needs-human-review"
    || hasCorrectionLifecycle(value)
    || !Array.isArray(value.extractionAudit) || value.extractionAudit.length !== 1
    || !value.extractionAudit[0]
    || value.extractionAudit[0].sourceRevision !== value.revision - 1
    || typeof value.extractionAudit[0].actorId !== "string"
    || !UUID.test(value.extractionAudit[0].actorId)
    || value.extractionAudit[0].sourceSha256 !== value.review.sourceSha256
    || value.extractionAudit[0].candidatesSha256 !== value.review.candidatesSha256
    || !value.scopeReview || value.scopeReview.state !== "reviewed-for-proposal-draft"
    || value.scopeReview.sourceRevision !== value.revision
    || typeof value.scopeReview.reviewedBy !== "string"
    || !UUID.test(value.scopeReview.reviewedBy)) {
    throw new Error("No valid committed human service review exists");
  }
}

/** Read-only INTERNAL proposal preview, never a commercial approval or send.
 * Both adapters must independently authorize tenant/source membership on each
 * primary/linearizable read. This interface does not prove a historical actor
 * had the required permission; only the trusted transactional write can.
 */
export async function readAuthorizedProposalDraftPreview(
  sourceStore: Pick<TrustedServiceReviewStore, "readAuthorized">,
  policyStore: Pick<TrustedPolicyStore, "readAuthorized">,
  session: unknown,
  selector: Selector,
): Promise<InternalProposalDraftPreview> {
  checkSelector(selector);
  // A caller may mutate its selector after the first async authorization.
  // Keep source, policy, receipt checksum and result on one original identity.
  const target: Selector = {
    organizationId: selector.organizationId, sourceId: selector.sourceId,
  };
  const readSource = () => sourceStore.readAuthorized({ ...target, session });
  const readPolicy = () => policyStore.readAuthorized({
    organizationId: target.organizationId, session,
  });
  const first = snapshotInertEvidence(await readSource(),
    "Unsafe original proposal evidence");
  // Reject accessor-backed/decorated persisted evidence before the review
  // validator, JSON fingerprint and approved-policy lookup can inspect it.

  checkStoredReview(first, target);
  const history = snapshotInertPolicyHistory(await readPolicy());
  if (!history) throw new Error("Company approved policy is unavailable");
  const approved = readActivePolicy(history, target.organizationId);
  const model = buildReviewWorkbench(first.original, first.review!, approved);
  const scope = first.scopeReview!;
  if (scope.reviewKey !== model.key
    || scope.policyRevision !== approved.revision) {
    throw new Error("Reviewed scope is bound to a stale company ratecard");
  }
  // Rebuild the selected services, consent and every cent ONLY from trusted
  // source evidence and the active approved policy, never stored prices.
  const selected = prepareReviewPreviewRequest(model, {
    key: scope.reviewKey,
    selectedIndices: scope.selectedIndices,
    acceptedAddonCodes: scope.acceptedAddonCodes,
  });
  const preview = previewReviewedEconomics(first.original, first.review!,
    selected.selectedIndices, approved, selected.acceptedAddonCodes);
  const expected = {
    state: "reviewed-for-proposal-draft",
    sourceRevision: first.revision,
    reviewedBy: scope.reviewedBy,
    reviewKey: model.key,
    sourceSha256: preview.sourceSha256,
    candidatesSha256: preview.candidatesSha256,
    selectedIndices: selected.selectedIndices,
    acceptedAddonCodes: selected.acceptedAddonCodes,
    policyRevision: preview.economics.policyRevision,
    policySha256: preview.economics.policySha256,
    reviewedSelectionSha256: preview.reviewedSelectionSha256,
  };
  if (!isDeepStrictEqual(scope, expected)) {
    throw new Error("Stored reviewed scope integrity check failed");
  }
  const originalSnapshotSha = snapshotSha(first);
  const latest = snapshotInertEvidence(await readSource(),
    "Unsafe original proposal evidence");

  checkStoredReview(latest, target);
  if (snapshotSha(latest) !== originalSnapshotSha) {
    throw new Error("Reviewed scope evidence changed during draft preview");
  }
  const currentPolicyHistory = snapshotInertPolicyHistory(await readPolicy());
  if (!currentPolicyHistory) {
    throw new Error("Company approved policy became unavailable");
  }
  const current = readActivePolicy(currentPolicyHistory, target.organizationId);
  const currentModel = buildReviewWorkbench(latest.original, latest.review!, current);
  if (currentModel.key !== scope.reviewKey) {
    throw new Error("Company ratecard changed during draft preview");
  }
  // Consistency identifier, NOT a signature, authorization, approval, or
  // idempotency key for a future send. Never trust this without a new atomic
  // check when producing a customer-visible proposal.
  const draftSnapshotSha256 = createHash("sha256").update(JSON.stringify([
    target.organizationId, target.sourceId, latest.revision,
    originalSnapshotSha, scope.reviewedSelectionSha256,
    preview.economics.policySha256,
  ])).digest("hex");
  return {
    state: "preview-only", purpose: "internal-proposal-draft",
    organizationId: target.organizationId, sourceId: target.sourceId,
    sourceRevision: latest.revision, reviewedBy: scope.reviewedBy,
    draftSnapshotSha256, preview,
  };
}
