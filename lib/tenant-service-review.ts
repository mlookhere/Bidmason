import { createHash } from "node:crypto";
import type { TenantExtractionRecord } from "./tenant-extraction-service.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { readActivePolicy } from "./company-policy-revisions.ts";
import { buildReviewWorkbench } from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";
import { previewReviewedEconomics } from "./intake-quote-preview.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export type ScopeReviewDecision = {
  sourceRevision: number;
  reviewedBy: string;
  reviewKey: string;
  sourceSha256: string;
  candidatesSha256: string;
  selectedIndices: number[];
  acceptedAddonCodes: string[];
  policyRevision: number;
  policySha256: string;
  reviewedSelectionSha256: string;
  state: "reviewed-for-proposal-draft";
};

export type TenantServiceReviewRecord = TenantExtractionRecord & {
  /** Null until explicitly reviewed; no client is allowed to set this directly. */
  scopeReview: ScopeReviewDecision | null;
};

/** Legacy original-extraction paths must never consume a correction lifecycle.
 * Inspect descriptors without executing getter-backed authority directives.
 * Explicit NULL optional DB columns are allowed for older, uncorrected rows. */
export function hasCorrectionLifecycle(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  for (const key of ["pendingCorrection", "activatedCorrection", "correctedScopeReview"]) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
      if (key in record) return true; // Never trust inherited lifecycle state.
      continue;
    }
    if (!Object.hasOwn(descriptor, "value")
      || (descriptor.value !== null && descriptor.value !== undefined)) {
      return true;
    }
  }
  return false;
}
type Selector = { organizationId: string; sourceId: string };

/** Must enforce CURRENT authenticated source ownership and reviewer permission
 * inside one atomic compare-and-swap transaction. No browser actor ID. */
export interface TrustedServiceReviewStore {
  readAuthorized(input: Selector & { session: unknown }): Promise<TenantServiceReviewRecord | null>;
  mutateAuthorized(input: Selector & { session: unknown; permission: "review-extraction";
    transform: (current: TenantServiceReviewRecord | null,
      authenticatedReviewerId: string) => TenantServiceReviewRecord;
  }): Promise<TenantServiceReviewRecord>;
}

function checkSelector(selector: Selector): void {
  if (!selector || typeof selector !== "object"
    || typeof selector.organizationId !== "string" || !UUID.test(selector.organizationId)
    || typeof selector.sourceId !== "string" || !UUID.test(selector.sourceId)) {
    throw new TypeError("Invalid reviewed intake source selector");
  }
}

function checkRecord(record: TenantServiceReviewRecord | null, selector: Selector):
  asserts record is TenantServiceReviewRecord {
  if (!record || record.organizationId !== selector.organizationId
    || record.sourceId !== selector.sourceId
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !record.original || !record.review || record.review.state !== "needs-human-review"
    || hasCorrectionLifecycle(record)
    || !Array.isArray(record.extractionAudit) || record.extractionAudit.length !== 1
    || !record.extractionAudit[0]
    || record.extractionAudit[0].sourceRevision !== record.revision
    || typeof record.extractionAudit[0].actorId !== "string"
    || !UUID.test(record.extractionAudit[0].actorId)
    || record.extractionAudit[0].sourceSha256 !== record.review.sourceSha256
    || record.extractionAudit[0].candidatesSha256 !== record.review.candidatesSha256
    || (record.scopeReview !== null && record.scopeReview !== undefined)) {
    throw new Error("Stored extraction is absent, malformed or already reviewed");
  }
}

/** Canonical legacy scope CAS; reused by read-only recovery. */
export function serviceReviewFingerprint(record: TenantServiceReviewRecord): string {
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review, record.extractionAudit, record.scopeReview,
    // Track optional nullable lifecycle fields across authorized reads.
    Object.getOwnPropertyDescriptor(record, "pendingCorrection")?.value ?? null,
    Object.getOwnPropertyDescriptor(record, "activatedCorrection")?.value ?? null,
    Object.getOwnPropertyDescriptor(record, "correctedScopeReview")?.value ?? null,
  ])).digest("hex");
}

async function policySnapshot(store: TrustedPolicyStore, session: unknown, organizationId: string) {
  const history = await store.readAuthorized({ session, organizationId });
  if (!history) throw new Error("An approved company policy is required");
  const active = readActivePolicy(history, organizationId);
  return active;
}

/** A review is always bound to both the current extraction/source revision and
 * the currently approved company policy. It is NOT proposal acceptance. */
export async function readServiceReviewContext(
  sourceStore: TrustedServiceReviewStore,
  policyStore: TrustedPolicyStore,
  session: unknown,
  selector: Selector,
) {
  checkSelector(selector);
  const first = await sourceStore.readAuthorized({ ...selector, session });
  checkRecord(first, selector);
  const policy = await policySnapshot(policyStore, session, selector.organizationId);
  const model = buildReviewWorkbench(first.original, first.review!, policy);
  const latest = await sourceStore.readAuthorized({ ...selector, session });
  checkRecord(latest, selector);
  if (serviceReviewFingerprint(first) !== serviceReviewFingerprint(latest)) {
    throw new Error("Intake evidence changed during review; refresh required");
  }
  const latestPolicy = await policySnapshot(policyStore, session, selector.organizationId);
  const latestModel = buildReviewWorkbench(latest.original, latest.review!, latestPolicy);
  if (latestModel.key !== model.key) {
    throw new Error("Company policy changed during review; refresh required");
  }
  return {
    state: "requires-human-service-review" as const,
    ...selector, expectedRevision: first.revision,
    expectedSnapshotSha256: serviceReviewFingerprint(first), model,
  };
}

export type ServiceReviewCommitRequest = Selector & {
  expectedRevision: number;
  expectedSnapshotSha256: string;
  reviewKey: string;
  selectedIndices: number[];
  acceptedAddonCodes: string[];
};

/** Commits explicit reviewed scope ONLY. Subsequent proposal approval/send
 * must reauthorize and require this exact source/policy binding to be current. */
export async function commitAuthorizedServiceReview(
  sourceStore: TrustedServiceReviewStore,
  policyStore: TrustedPolicyStore,
  session: unknown,
  request: ServiceReviewCommitRequest,
): Promise<{ state: "reviewed-for-proposal-draft"; sourceId: string;
  revision: number; reviewedSelectionSha256: string; reviewedBy: string }> {
  checkSelector(request);
  if (Object.keys(request).length !== 7 || [
    "organizationId", "sourceId", "expectedRevision", "expectedSnapshotSha256",
    "reviewKey", "selectedIndices", "acceptedAddonCodes",
  ].some(k => !Object.hasOwn(request, k))
    || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.reviewKey !== "string" || !HASH.test(request.reviewKey)
    || !Array.isArray(request.selectedIndices)
    || !Array.isArray(request.acceptedAddonCodes)) {
    throw new TypeError("Invalid reviewed scope commit request");
  }
  const policy = await policySnapshot(policyStore, session, request.organizationId);
  const expected: { record: TenantServiceReviewRecord | null } = {record:null};
  const committed = await sourceStore.mutateAuthorized({
    organizationId: request.organizationId, sourceId: request.sourceId,
    session, permission: "review-extraction",
    transform(current, actorId) {
      checkRecord(current, request);
      if (typeof actorId !== "string" || !UUID.test(actorId)) {
        throw new Error("Authenticated service reviewer identity required");
      }
      if (current.revision !== request.expectedRevision
        || serviceReviewFingerprint(current) !== request.expectedSnapshotSha256) {
        throw new Error("Stale reviewed extraction revision; reload");
      }
      const model = buildReviewWorkbench(current.original, current.review!, policy);
      if (model.key !== request.reviewKey) {
        throw new Error("Approved company policy or review key changed");
      }
      const selection = prepareReviewPreviewRequest(model, {
        key:request.reviewKey, selectedIndices:request.selectedIndices,
        acceptedAddonCodes:request.acceptedAddonCodes,
      });
      const preview = previewReviewedEconomics(current.original, current.review!,
        selection.selectedIndices, policy, selection.acceptedAddonCodes);
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("Source revision overflow");
      const revision = current.revision + 1;
      const scopeReview: ScopeReviewDecision = {
        state: "reviewed-for-proposal-draft", sourceRevision:revision,
        reviewedBy:actorId, reviewKey:model.key,
        sourceSha256:preview.sourceSha256,
        candidatesSha256:preview.candidatesSha256,
        selectedIndices:selection.selectedIndices,
        acceptedAddonCodes:selection.acceptedAddonCodes,
        policyRevision:preview.economics.policyRevision,
        policySha256:preview.economics.policySha256,
        reviewedSelectionSha256:preview.reviewedSelectionSha256,
      };
      const next: TenantServiceReviewRecord = {...current, revision, scopeReview};
      expected.record = structuredClone(next);
      return next;
    },
  });
  if (!expected.record || serviceReviewFingerprint(committed) !== serviceReviewFingerprint(expected.record)) {
    throw new Error("Scope review mutation did not confirm the expected transition");
  }
  // Authorized primary read-back; a failure is INDETERMINATE, not rollback.
  const persisted = await sourceStore.readAuthorized({
    organizationId:request.organizationId, sourceId:request.sourceId, session,
  });
  if (!persisted || serviceReviewFingerprint(persisted) !== serviceReviewFingerprint(expected.record)) {
    throw new Error("Reviewed scope did not match authorized read-back");
  }
  // Policy changes after the write leave a durable but stale bound decision.
  // Never claim current approval; downstream must always revalidate binding.
  const latestPolicy = await policySnapshot(policyStore, session, request.organizationId);
  const latestModel = buildReviewWorkbench(persisted.original, persisted.review!, latestPolicy);
  if (latestModel.key !== request.reviewKey) {
    throw new Error("Company policy changed during reviewed scope commit; reconcile");
  }
  return {
    state:"reviewed-for-proposal-draft",sourceId:request.sourceId,
    revision:persisted.revision,
    reviewedSelectionSha256:persisted.scopeReview!.reviewedSelectionSha256,
    reviewedBy:persisted.scopeReview!.reviewedBy,
  };
}
