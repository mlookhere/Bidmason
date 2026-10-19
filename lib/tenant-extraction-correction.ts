import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { prepareExtractionReview, selectReviewedServices, type ExtractionReview } from "./intake-review.ts";
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

/** Distinct authorized activation of a pending correction, still not a
 * selected, priced or approved proposal. Full lineage remains immutable. */
export type ActivatedExtractionCorrection = {
  state: "awaiting-renewed-human-scope-review";
  sourceRevision: number;
  activatedBy: string;
  activationSha256: string;
  priorCorrection: PendingExtractionCorrection;
  correctedReview: ExtractionReview;
};

export type TenantExtractionCorrectionRecord = TenantServiceReviewRecord & {
  /** Original extraction review and original extraction audit stay unchanged. */
  pendingCorrection?: PendingExtractionCorrection | null;
  activatedCorrection?: ActivatedExtractionCorrection | null;
};

/** The adapter MUST authorize current tenant/source and correct-extraction
 * permission inside one locked, durable CAS transaction. Reads must come
 * from the authorized primary. This module is not a live Supabase adapter. */
export interface TrustedExtractionCorrectionStore {
  readAuthorized(input: Selector & { session: unknown }):
    Promise<TenantExtractionCorrectionRecord | null>;
  mutateAuthorized(input: Selector & {
    session: unknown;
    permission: "correct-extraction" | "activate-extraction-correction";
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
    || value.activatedCorrection != null
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
    record.pendingCorrection ?? null, record.activatedCorrection ?? null,
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
  if (keys.length !== names.length || keys.some(key => {
    if (typeof key !== "string" || !names.includes(key)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(request, key);
    return descriptor?.enumerable !== true
      || !descriptor || !Object.hasOwn(descriptor, "value");
  })) {
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

function actionsFromPending(pending: PendingExtractionCorrection):
  ExtractionCorrectionChange[] {
  if (!Array.isArray(pending.changes)
    || pending.changes.length < 1 || pending.changes.length > 100) {
    throw new Error("Pending extraction correction audit is malformed");
  }
  return pending.changes.map(change => {
    if (change.action === "add" && change.after) {
      return {action:"add" as const, candidate:change.after, reason:change.reason};
    }
    if (change.action === "remove" && Number.isSafeInteger(change.originalIndex)) {
      return {action:"remove" as const, index:change.originalIndex!, reason:change.reason};
    }
    if (change.action === "replace" && Number.isSafeInteger(change.originalIndex)
      && change.after) {
      return {action:"replace" as const, index:change.originalIndex!,
        candidate:change.after, reason:change.reason};
    }
    throw new Error("Unsupported pending extraction correction audit");
  });
}

function verifiedPending(record: TenantExtractionCorrectionRecord):
  {pending: PendingExtractionCorrection; correctedReview: ExtractionReview} {
  const pending = record.pendingCorrection;
  if (!pending || pending.state !== "pending-authorized-activation"
    || pending.sourceRevision !== record.revision
    || typeof pending.correctedBy !== "string" || !UUID.test(pending.correctedBy)
    || record.scopeReview !== null) {
    throw new Error("Pending extraction correction is absent or inconsistent");
  }
  // Reconstruct all changes against the original immutable source and model
  // extraction, rather than trusting persisted proposed candidates or hashes.
  const proposal = prepareExtractionCorrectionDraft(
    record.original, record.review!, actionsFromPending(pending));
  const expected: PendingExtractionCorrection = {
    state:"pending-authorized-activation",
    sourceRevision:record.revision,
    correctedBy:pending.correctedBy,
    originalCandidatesSha256:proposal.originalCandidatesSha256,
    proposedCandidatesSha256:proposal.proposedCandidatesSha256,
    correctionSha256:proposal.correctionSha256,
    changes:proposal.changes,
    proposedCandidates:proposal.proposedCandidates,
    invalidatedScopeReview:pending.invalidatedScopeReview,
  };
  if (!isDeepStrictEqual(pending, expected)) {
    throw new Error("Pending correction lineage does not match original evidence");
  }
  const correctedReview = prepareExtractionReview(
    record.original, proposal.proposedCandidates);
  return {pending, correctedReview};
}

export type ActivationCommitRequest = Selector & {
  expectedRevision: number;
  expectedSnapshotSha256: string;
  expectedCorrectionSha256: string;
};

function checkActivationRequest(request: ActivationCommitRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) {
    throw new TypeError("Invalid correction activation request");
  }
  const names = ["organizationId","sourceId","expectedRevision",
    "expectedSnapshotSha256","expectedCorrectionSha256"];
  const keys = Reflect.ownKeys(request);
  if (keys.length !== names.length || keys.some(key => {
    if (typeof key !== "string" || !names.includes(key)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(request, key);
    return !descriptor || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, "value");
  })) {
    throw new TypeError("Invalid correction activation request");
  }
  selector(request);
  if (!Number.isSafeInteger(request.expectedRevision)
    || request.expectedRevision < 3
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.expectedCorrectionSha256 !== "string"
    || !HASH.test(request.expectedCorrectionSha256)) {
    throw new TypeError("Invalid correction activation request");
  }
}

/** Read-only preparation. Observation is never authorization to activate;
 * the store MUST independently reauthorize on the subsequent locked write. */
export async function readExtractionActivationContext(
  store: Pick<TrustedExtractionCorrectionStore, "readAuthorized">,
  session: unknown, target: Selector,
): Promise<{state:"requires-authorized-extraction-activation"; organizationId:string;
  sourceId:string; expectedRevision:number; expectedSnapshotSha256:string;
  expectedCorrectionSha256:string}> {
  selector(target);
  const first = await store.readAuthorized({...target, session});
  checkRecord(first, target, true);
  const {pending} = verifiedPending(first);
  const stamp = fingerprint(first);
  const last = await store.readAuthorized({...target, session});
  checkRecord(last, target, true);
  verifiedPending(last);
  if (fingerprint(last) !== stamp) {
    throw new Error("Pending correction changed during activation preparation");
  }
  return {state:"requires-authorized-extraction-activation", ...target,
    expectedRevision:first.revision, expectedSnapshotSha256:stamp,
    expectedCorrectionSha256:pending.correctionSha256};
}

/** Server-only, independent CAS activation of already committed correction.
 * Keeps original model extraction and earlier scope audit immutable, and
 * produces a NEW review requiring human selection. Not a quote or send. */
export async function commitAuthorizedExtractionActivation(
  store: TrustedExtractionCorrectionStore, session: unknown,
  request: ActivationCommitRequest,
): Promise<{state:"activated-for-renewed-human-scope-review"; sourceId:string;
  revision:number; activatedBy:string; activationSha256:string}> {
  checkActivationRequest(request);
  let expected: TenantExtractionCorrectionRecord | null = null;
  const committed = await store.mutateAuthorized({
    organizationId:request.organizationId, sourceId:request.sourceId,
    session, permission:"activate-extraction-correction",
    transform(current, actorId) {
      checkRecord(current, request, true);
      if (typeof actorId !== "string" || !UUID.test(actorId)) {
        throw new Error("Authenticated correction activator identity required");
      }
      if (current.revision !== request.expectedRevision
        || fingerprint(current) !== request.expectedSnapshotSha256) {
        throw new Error("Stale correction activation source; refresh required");
      }
      const {pending, correctedReview} = verifiedPending(current);
      if (pending.correctionSha256 !== request.expectedCorrectionSha256) {
        throw new Error("Pending correction digest has changed");
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Extraction activation revision overflow");
      }
      const revision = current.revision + 1;
      const activationSha256 = createHash("sha256").update(JSON.stringify([
        current.organizationId,current.sourceId,revision,actorId,
        fingerprint(current),pending.correctionSha256,
        correctedReview.candidatesSha256,
      ])).digest("hex");
      const activatedCorrection: ActivatedExtractionCorrection = {
        state:"awaiting-renewed-human-scope-review",
        sourceRevision:revision,
        activatedBy:actorId,activationSha256,
        priorCorrection:structuredClone(pending),
        correctedReview,
      };
      const next: TenantExtractionCorrectionRecord = {
        ...current,revision,scopeReview:null,
        pendingCorrection:null,activatedCorrection,
      };
      expected = structuredClone(next);
      return next;
    },
  });
  if (!expected || fingerprint(committed) !== fingerprint(expected)) {
    throw new Error("Extraction activation mutation not confirmed");
  }
  const last = await store.readAuthorized({
    session,organizationId:request.organizationId,sourceId:request.sourceId,
  });
  if (!last || fingerprint(last) !== fingerprint(expected)) {
    throw new Error("Extraction activation read-back not confirmed");
  }
  const saved = last.activatedCorrection;
  if (!saved || saved.state !== "awaiting-renewed-human-scope-review"
    || saved.sourceRevision !== last.revision || last.scopeReview !== null
    || last.pendingCorrection !== null) {
    throw new Error("Activated correction missing immutable review lineage");
  }
  return {state:"activated-for-renewed-human-scope-review",
    sourceId:last.sourceId,revision:last.revision,
    activatedBy:saved.activatedBy,activationSha256:saved.activationSha256};
}
