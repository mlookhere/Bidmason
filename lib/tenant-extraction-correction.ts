import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { selectReviewedServices } from "./intake-review.ts";
import { prepareExtractionCorrectionDraft,
  type ExtractionCorrectionAudit, type ExtractionCorrectionChange }
  from "./extraction-correction-draft.ts";
import type { TenantServiceReviewRecord, ScopeReviewDecision }
  from "./tenant-service-review.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
type Selector = { organizationId: string; sourceId: string };

export type PendingExtractionCorrection = {
  state: "pending-authorized-activation";
  sourceRevision: number;
  correctedBy: string;
  originalCandidatesSha256: string;
  proposedCandidatesSha256: string;
  correctionSha256: string;
  changes: ExtractionCorrectionAudit[];
  proposedCandidates: ReturnType<typeof prepareExtractionCorrectionDraft>["proposedCandidates"];
  /** Prior reviewed scope is retained for audit but no longer active. */
  invalidatedScopeReview: ScopeReviewDecision | null;
};

export type TenantExtractionCorrectionRecord = TenantServiceReviewRecord & {
  /** A correction is never usable as an approved extraction or quote. */
  pendingCorrection?: PendingExtractionCorrection | null;
};

/** The adapter MUST authorize current tenant/source and correct-extraction
 * permission inside one locked, durable CAS transaction. Reads must come
 * from the authorized primary. This module is not a live Supabase adapter. */
export interface TrustedExtractionCorrectionStore {
  readAuthorized(input: Selector & { session: unknown }):
    Promise<TenantExtractionCorrectionRecord | null>;
  mutateAuthorized(input: Selector & {
    session: unknown;
    permission: "correct-extraction";
    transform: (current: TenantExtractionCorrectionRecord | null,
      authenticatedActorId: string) => TenantExtractionCorrectionRecord;
  }): Promise<TenantExtractionCorrectionRecord>;
}

function selector(value: unknown): asserts value is Selector {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid extraction correction selector");
  }
  const v = value as Selector;
  if (typeof v.organizationId !== "string" || !UUID.test(v.organizationId)
    || typeof v.sourceId !== "string" || !UUID.test(v.sourceId)) {
    throw new TypeError("Invalid extraction correction selector");
  }
}

function checkRecord(value: TenantExtractionCorrectionRecord | null,
  target: Selector, allowPending = false): asserts value is TenantExtractionCorrectionRecord {
  if (!value || value.organizationId !== target.organizationId
    || value.sourceId !== target.sourceId
    || !Number.isSafeInteger(value.revision) || value.revision < 2
    || !value.original || !value.review
    || !Array.isArray(value.extractionAudit) || value.extractionAudit.length !== 1
    || !value.extractionAudit[0]
    || typeof value.extractionAudit[0].actorId !== "string"
    || !UUID.test(value.extractionAudit[0].actorId)
    || !Number.isSafeInteger(value.extractionAudit[0].sourceRevision)
    || value.extractionAudit[0].sourceRevision < 2
    || value.extractionAudit[0].sourceRevision > value.revision
    || value.extractionAudit[0].sourceSha256 !== value.review.sourceSha256
    || value.extractionAudit[0].candidatesSha256 !== value.review.candidatesSha256
    || (value.scopeReview !== null && value.scopeReview !== undefined
      && (value.scopeReview.state !== "reviewed-for-proposal-draft"
        || value.scopeReview.sourceRevision !== value.revision))
    || (!allowPending && value.pendingCorrection != null)) {
    throw new Error("Authorized extraction correction source missing, stale or unavailable");
  }
  // Revalidate the entire immutable model suggestion, even unselected rows.
  const count = value.review.candidates?.length;
  if (!Number.isSafeInteger(count) || count < 1 || count > 50) {
    throw new Error("Stored extraction candidates are invalid");
  }
  selectReviewedServices(value.original, value.review,
    Array.from({length: count}, (_, index) => index));
}

function fingerprint(record: TenantExtractionCorrectionRecord): string {
  // A snapshot comparison, not tenant authorization or a signature.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review, record.extractionAudit,
    record.creationAudit ?? null, record.scopeReview ?? null,
    record.pendingCorrection ?? null,
  ])).digest("hex");
}

export async function readExtractionCorrectionContext(
  store: TrustedExtractionCorrectionStore, session: unknown, target: Selector,
): Promise<{ state: "requires-human-extraction-correction"; organizationId: string;
  sourceId: string; expectedRevision: number; expectedSnapshotSha256: string }> {
  selector(target);
  const first = await store.readAuthorized({...target, session});
  checkRecord(first, target);
  const stamp = fingerprint(first);
  const last = await store.readAuthorized({...target, session});
  checkRecord(last, target);
  if (stamp !== fingerprint(last)) {
    throw new Error("Source changed during extraction correction preparation");
  }
  return {state:"requires-human-extraction-correction", ...target,
    expectedRevision:first.revision, expectedSnapshotSha256:stamp};
}

export type ExtractionCorrectionCommitRequest = Selector & {
  expectedRevision: number;
  expectedSnapshotSha256: string;
  expectedCorrectionSha256: string;
  changes: ExtractionCorrectionChange[];
};

function checkRequest(request: ExtractionCorrectionCommitRequest): void {
  // A correction request is plain, data-only JSON. Hidden fields or getters
  // may not change its expected revision/digest during a two-read recovery.
  if (!request || typeof request !== "object" || Array.isArray(request)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) {
    throw new TypeError("Invalid extraction correction request");
  }
  const names = ["organizationId","sourceId","expectedRevision",
    "expectedSnapshotSha256","expectedCorrectionSha256","changes"];
  const keys = Reflect.ownKeys(request);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string"
    || !names.includes(key) || !Object.hasOwn(request, key)
    || Object.getOwnPropertyDescriptor(request, key)?.enumerable !== true
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(request, key), "value"))) {
    throw new TypeError("Invalid extraction correction request");
  }
  selector(request);
  if (!Number.isSafeInteger(request.expectedRevision)
    || request.expectedRevision < 2
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.expectedCorrectionSha256 !== "string"
    || !HASH.test(request.expectedCorrectionSha256)
    || !Array.isArray(request.changes)) {
    throw new TypeError("Invalid extraction correction request");
  }
}

/** Commit an explicitly reasoned pending correction, NOT an approved review.
 * A fresh authenticated read-back confirms the exact durable transaction;
 * failure to read back is indeterminate, not proof of rollback or permission
 * to retry. The provider review and extraction audit remain untouched. */
export async function commitAuthorizedExtractionCorrection(
  store: TrustedExtractionCorrectionStore,
  session: unknown,
  request: ExtractionCorrectionCommitRequest,
): Promise<{ state: "correction-committed-pending-activation";
  sourceId: string; revision: number; correctedBy: string;
  correctionSha256: string }> {
  checkRequest(request);
  let expected: TenantExtractionCorrectionRecord | null = null;
  const committed = await store.mutateAuthorized({
    organizationId:request.organizationId, sourceId:request.sourceId,
    session, permission:"correct-extraction",
    transform(current, actorId) {
      checkRecord(current, request);
      if (typeof actorId !== "string" || !UUID.test(actorId)) {
        throw new Error("Authenticated extraction corrector identity required");
      }
      if (current.revision !== request.expectedRevision
        || fingerprint(current) !== request.expectedSnapshotSha256) {
        throw new Error("Stale extraction correction; reload the source");
      }
      const draft = prepareExtractionCorrectionDraft(
        current.original, current.review!, request.changes);
      if (draft.correctionSha256 !== request.expectedCorrectionSha256) {
        throw new Error("Human correction decisions changed; review again");
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Extraction source revision overflow");
      }
      const nextRevision = current.revision + 1;
      const pendingCorrection: PendingExtractionCorrection = {
        state:"pending-authorized-activation",
        sourceRevision:nextRevision,
        correctedBy:actorId,
        originalCandidatesSha256:draft.originalCandidatesSha256,
        proposedCandidatesSha256:draft.proposedCandidatesSha256,
        correctionSha256:draft.correctionSha256,
        changes:draft.changes,
        proposedCandidates:draft.proposedCandidates,
        invalidatedScopeReview:current.scopeReview ?? null,
      };
      const next: TenantExtractionCorrectionRecord = {
        ...current, revision:nextRevision,
        scopeReview:null, pendingCorrection,
      };
      expected = structuredClone(next);
      return next;
    },
  });
  if (!expected || fingerprint(committed) !== fingerprint(expected)) {
    throw new Error("Extraction correction mutation not confirmed");
  }
  const persisted = await store.readAuthorized({
    session, organizationId:request.organizationId, sourceId:request.sourceId,
  });
  if (!persisted || fingerprint(persisted) !== fingerprint(expected)) {
    throw new Error("Extraction correction read-back not confirmed");
  }
  const audit = persisted.pendingCorrection;
  if (!audit || audit.state !== "pending-authorized-activation"
    || audit.sourceRevision !== persisted.revision
    || audit.correctionSha256 !== request.expectedCorrectionSha256
    || persisted.scopeReview !== null) {
    throw new Error("Committed correction missing its pending audit");
  }
  return { state:"correction-committed-pending-activation",
    sourceId:persisted.sourceId, revision:persisted.revision,
    correctedBy:audit.correctedBy, correctionSha256:audit.correctionSha256 };
}

export type ExtractionCorrectionReconciliation =
  | { state: "unchanged-at-read"; sourceId: string }
  | { state: "recorded-pending-at-read"; sourceId: string; revision: number;
      correctedBy: string; correctionSha256: string }
  | { state: "conflict"; sourceId: string };

/**
 * Read-only recovery after a mutation or confirmation has an indeterminate
 * outcome. This never retries, activates corrected evidence, or authorizes
 * a future preview. Both reads must be current authenticated primary reads.
 * "Unchanged" is ONLY an observation: it cannot prove rollback or prevent
 * an in-flight transaction from committing after the read.
 */
export async function reconcileExtractionCorrection(
  store: Pick<TrustedExtractionCorrectionStore, "readAuthorized">,
  session: unknown, request: ExtractionCorrectionCommitRequest,
): Promise<ExtractionCorrectionReconciliation> {
  checkRequest(request);
  const target = {
    organizationId:request.organizationId, sourceId:request.sourceId,
  };
  // Freeze the expected scalars before asynchronous reads.
  const revision = request.expectedRevision;
  const expectedSnapshot = request.expectedSnapshotSha256;
  const expectedCorrection = request.expectedCorrectionSha256;
  const changes = request.changes;
  const read = () => store.readAuthorized({...target, session});
  const first = await read();
  if (!first || first.organizationId !== target.organizationId
    || first.sourceId !== target.sourceId) {
    throw new Error("Authorized extraction correction source unavailable");
  }
  let classification: ExtractionCorrectionReconciliation = {
    state:"conflict", sourceId:target.sourceId,
  };
  let stamp: string;
  try {
    // The model review itself is still the original provider extraction.
    // It must be independently structurally valid in BOTH read states.
    checkRecord(first, target, true);
    stamp = fingerprint(first);
    if (first.revision === revision && first.pendingCorrection == null
      && fingerprint(first) === expectedSnapshot) {
      classification = {state:"unchanged-at-read",sourceId:target.sourceId};
    } else if (revision < Number.MAX_SAFE_INTEGER
      && first.revision === revision + 1
      && first.scopeReview === null && first.pendingCorrection != null) {
      const pending = first.pendingCorrection;
      if (pending.state === "pending-authorized-activation"
        && pending.sourceRevision === first.revision
        && typeof pending.correctedBy === "string"
        && UUID.test(pending.correctedBy)) {
        const before: TenantExtractionCorrectionRecord = {
          ...first,
          revision,
          pendingCorrection:null,
          scopeReview:pending.invalidatedScopeReview,
        };
        // This confirms the original extraction, old scope, revision, and
        // source audit have not been rewritten to counterfeit this action.
        checkRecord(before, target);
        if (fingerprint(before) === expectedSnapshot) {
          const computed = prepareExtractionCorrectionDraft(
            first.original, first.review!, changes);
          const expectedPending: PendingExtractionCorrection = {
            state:"pending-authorized-activation",
            sourceRevision:first.revision,
            correctedBy:pending.correctedBy,
            originalCandidatesSha256:computed.originalCandidatesSha256,
            proposedCandidatesSha256:computed.proposedCandidatesSha256,
            correctionSha256:computed.correctionSha256,
            changes:computed.changes,
            proposedCandidates:computed.proposedCandidates,
            invalidatedScopeReview:pending.invalidatedScopeReview,
          };
          if (computed.correctionSha256 === expectedCorrection
            && isDeepStrictEqual(pending, expectedPending)) {
            classification = {
              state:"recorded-pending-at-read",
              sourceId:target.sourceId, revision:first.revision,
              correctedBy:pending.correctedBy,
              correctionSha256:computed.correctionSha256,
            };
          }
        }
      }
    }
  } catch {
    // Malformed or incompatible stored evidence is a conflict, not a grant.
    // Authorization denial and missing source are handled OUTSIDE this catch.
    classification = {state:"conflict",sourceId:target.sourceId};
    stamp = "";
  }
  // A disappeared record or authorization denial must NEVER be translated
  // into a confirmation, conflict-as-absence, or permission to retry.
  const second = await read();
  if (!second || !first
    || second.organizationId !== target.organizationId
    || second.sourceId !== target.sourceId
    || first.organizationId !== target.organizationId
    || first.sourceId !== target.sourceId) {
    throw new Error("Authorized extraction correction source unavailable");
  }
  try {
    checkRecord(second, target, true);
    if (fingerprint(second) !== stamp) {
      return {state:"conflict",sourceId:target.sourceId};
    }
  } catch {
    return {state:"conflict",sourceId:target.sourceId};
  }
  return classification;
}
