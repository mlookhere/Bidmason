import { inertEvidenceGraph } from "./inert-evidence-graph.ts";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readActivePolicy } from "./company-policy-revisions.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { verifyActivatedCorrectionLineage } from "./tenant-extraction-correction.ts";
import type { TrustedCorrectedScopeStore, TenantCorrectedScopeRecord,
  CorrectedScopeDecision } from "./tenant-corrected-scope-review.ts";
import { buildReviewWorkbench } from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";
import { previewReviewedEconomics, type ReviewedEconomicsPreview }
  from "./intake-quote-preview.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Selector = { organizationId: string; sourceId: string };

export type CorrectedProposalDraftPreview = {
  state: "preview-only";
  purpose: "internal-corrected-proposal-draft";
  organizationId: string;
  sourceId: string;
  sourceRevision: number;
  reviewedBy: string;
  activationSha256: string;
  draftSnapshotSha256: string;
  preview: ReviewedEconomicsPreview;
};

function checkSelector(value: Selector): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== 2
    || ["organizationId", "sourceId"].some(name => {
      const d = Object.getOwnPropertyDescriptor(value, name);
      return !d || !d.enumerable || !Object.hasOwn(d, "value");
    })
    || typeof value.organizationId !== "string" || !UUID.test(value.organizationId)
    || typeof value.sourceId !== "string" || !UUID.test(value.sourceId)) {
    throw new TypeError("Invalid corrected proposal draft selector");
  }
}

function checkReviewed(record: TenantCorrectedScopeRecord | null, selector: Selector):
  asserts record is TenantCorrectedScopeRecord & {correctedScopeReview: CorrectedScopeDecision} {
  if (!record || record.organizationId !== selector.organizationId
    || record.sourceId !== selector.sourceId
    || record.scopeReview !== null || record.pendingCorrection != null
    || !record.correctedScopeReview
    || record.correctedScopeReview.state !== "reviewed-corrected-scope-internal-only"
    || record.correctedScopeReview.sourceRevision !== record.revision
    || typeof record.correctedScopeReview.reviewedBy !== "string"
    || !UUID.test(record.correctedScopeReview.reviewedBy)) {
    throw new Error("No valid renewed human corrected-scope review exists");
  }
  verifyActivatedCorrectionLineage(record, selector);
}

function sourceStamp(record: TenantCorrectedScopeRecord): string {
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review, record.extractionAudit,
    record.creationAudit ?? null, record.scopeReview,
    record.pendingCorrection ?? null, record.activatedCorrection,
    record.correctedScopeReview ?? null,
  ])).digest("hex");
}

/** Internal-only calculation from a separately reviewed corrected extraction.
 * Both data sources must freshly authorize the current tenant on each read.
 * No persistent approval, customer proposal, publish or send operation. */
export async function readAuthorizedCorrectedProposalDraftPreview(
  sourceStore: Pick<TrustedCorrectedScopeStore, "readAuthorized">,
  policyStore: Pick<TrustedPolicyStore, "readAuthorized">,
  session: unknown, selector: Selector,
): Promise<CorrectedProposalDraftPreview> {
  checkSelector(selector);
  // Both authenticated reads, corrected evidence verification and the
  // deterministic fingerprint must use the original tenant/source identity.
  const target:Selector={organizationId:selector.organizationId,
    sourceId:selector.sourceId};
  const readSource = () => sourceStore.readAuthorized({...target, session});
  const readPolicy = () => policyStore.readAuthorized({
    organizationId: target.organizationId, session,
  });
  const first = await readSource();
  if (!inertEvidenceGraph(first)) {
    throw new Error("Unsafe corrected proposal evidence");
  }
  checkReviewed(first, target);
  const originalStamp = sourceStamp(first);
  const evidence = verifyActivatedCorrectionLineage(first, target);
  const scope = first.correctedScopeReview;
  const history = await readPolicy();
  if (!history) throw new Error("Approved company policy is unavailable");
  const policy = readActivePolicy(history, target.organizationId);
  const model = buildReviewWorkbench(first.original, evidence.correctedReview, policy);
  if (scope.activationSha256 !== evidence.activationSha256
    || scope.reviewKey !== model.key
    || scope.policyRevision !== policy.revision) {
    throw new Error("Renewed scope is bound to stale correction or company pricing");
  }
  const selection = prepareReviewPreviewRequest(model, {
    key: scope.reviewKey,
    selectedIndices: scope.selectedIndices,
    acceptedAddonCodes: scope.acceptedAddonCodes,
  });
  const preview = previewReviewedEconomics(first.original, evidence.correctedReview,
    selection.selectedIndices, policy, selection.acceptedAddonCodes);
  const expected: CorrectedScopeDecision = {
    state: "reviewed-corrected-scope-internal-only",
    sourceRevision: first.revision,
    reviewedBy: scope.reviewedBy,
    activationSha256: evidence.activationSha256,
    reviewKey: model.key,
    sourceSha256: preview.sourceSha256,
    candidatesSha256: preview.candidatesSha256,
    selectedIndices: selection.selectedIndices,
    acceptedAddonCodes: selection.acceptedAddonCodes,
    policyRevision: preview.economics.policyRevision,
    policySha256: preview.economics.policySha256,
    reviewedSelectionSha256: preview.reviewedSelectionSha256,
  };
  if (!isDeepStrictEqual(scope, expected)) {
    throw new Error("Stored corrected scope integrity check failed");
  }
  const latest = await readSource();
  if (!inertEvidenceGraph(latest)) {
    throw new Error("Unsafe corrected proposal evidence");
  }
  checkReviewed(latest, target);
  if (sourceStamp(latest) !== originalStamp) {
    throw new Error("Corrected evidence changed during internal draft preview");
  }
  const latestHistory = await readPolicy();
  if (!latestHistory) throw new Error("Approved company policy became unavailable");
  const latestPolicy = readActivePolicy(latestHistory, target.organizationId);
  const latestModel = buildReviewWorkbench(latest.original,
    verifyActivatedCorrectionLineage(latest, target).correctedReview, latestPolicy);
  if (latestModel.key !== model.key) {
    throw new Error("Company pricing changed during corrected draft preview");
  }
  const draftSnapshotSha256 = createHash("sha256").update(JSON.stringify([
    target.organizationId, target.sourceId, latest.revision, originalStamp,
    evidence.activationSha256, scope.reviewedSelectionSha256,
    preview.economics.policySha256,
  ])).digest("hex");
  return {state:"preview-only", purpose:"internal-corrected-proposal-draft",
    organizationId:target.organizationId,sourceId:target.sourceId,
    sourceRevision:latest.revision,reviewedBy:scope.reviewedBy,
    activationSha256:evidence.activationSha256,draftSnapshotSha256,preview};
}
