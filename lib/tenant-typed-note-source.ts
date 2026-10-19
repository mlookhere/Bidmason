import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TenantServiceReviewRecord } from "./tenant-service-review.ts";
import { selectReviewedServices } from "./intake-review.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_TEXT_BYTES = 64 * 1024;

/** Original typed notes are immutable. The backend, not the request, supplies
 * the new source UUID and authenticated actor and owns the request-ID ledger. */
export type TypedNoteSourceRecord = TenantServiceReviewRecord & {
  creationAudit: {
    actorId: string;
    requestId: string;
    textSha256: string;
  };
};

export type TypedNoteCreateRequest = {
  organizationId: string;
  requestId: string;
  text: string;
};

/**
 * Production contract: createAuthorized MUST use an atomic tenant-scoped
 * transaction and UNIQUE (organization_id, actor_id, request_id) ledger. It
 * authorizes current membership, "create-intake" role and source visibility
 * even on duplicate submissions, and refuses a different payload for a
 * reused request ID. On a replay after extraction or scope review the adapter
 * returns the current tenant-owned record, never a second source. For new
 * requests it allocates sourceId on the server and invokes materialize exactly
 * once inside the same transaction.
 *
 * If a provider cannot guarantee these semantics, do not expose the workflow.
 */
export interface TrustedTypedNoteSourceStore {
  createAuthorized(input: {
    session: unknown;
    organizationId: string;
    requestId: string;
    permission: "create-intake";
    textSha256: string;
    materialize: (verified: {
      sourceId: string;
      authenticatedActorId: string;
    }) => TypedNoteSourceRecord;
  }): Promise<{ record: TypedNoteSourceRecord; authenticatedActorId: string }>;
  /** Require fresh tenant/source/member authorization from primary storage. */
  readAuthorized(input: {
    session: unknown;
    organizationId: string;
    sourceId: string;
  }): Promise<TypedNoteSourceRecord | null>;
}

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Fail closed on unexpected model or client-owned fields in persisted evidence.
 * Review digests hash known candidate fields, so hashes alone cannot detect
 * smuggled rateCents, approval or send directives. */
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

const SOURCE_KEYS = ["organizationId", "sourceId", "revision", "original",
  "review", "extractionAudit", "scopeReview", "creationAudit"];
const REVIEW_KEYS = ["state", "kind", "sourceSha256", "candidatesSha256", "candidates"];
const CANDIDATE_KEYS = ["serviceCode", "units", "start", "end", "excerpt"];

export function validateTypedNoteCreateRequest(request: TypedNoteCreateRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).length !== 3
    || !["organizationId", "requestId", "text"].every(k =>
      Object.hasOwn(request, k))
    || typeof request.organizationId !== "string"
    || !UUID.test(request.organizationId)
    || typeof request.requestId !== "string" || !UUID.test(request.requestId)
    || typeof request.text !== "string" || !request.text.trim()
    || Buffer.byteLength(request.text, "utf8") > MAX_TEXT_BYTES
    || request.text.includes("\u0000")
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(request.text)) {
    throw new TypeError("Invalid, empty or unbounded typed-note creation request");
  }
}

function build(request: TypedNoteCreateRequest, textSha256: string,
  sourceId: string, actorId: string): TypedNoteSourceRecord {
  if (!UUID.test(sourceId) || !UUID.test(actorId)) {
    throw new Error("Server-assigned source and authenticated actor IDs required");
  }
  return {
    organizationId: request.organizationId,
    sourceId,
    revision: 1,
    original: { kind: "typed-note", text: request.text },
    review: null,
    extractionAudit: [],
    scopeReview: null,
    creationAudit: { actorId, requestId: request.requestId, textSha256 },
  };
}

/** Validate the immutable creation identity AND the *current* lifecycle.
 * A replay after downstream processing must not fail simply because the
 * originally created record has advanced. We never infer approval from it.
 * This contract currently supports source revisions 1, 2, and 3 only.
 */
export function verifyTypedNoteSourceRecord(record: TypedNoteSourceRecord | null,
  request: TypedNoteCreateRequest, textSha256: string, actorId: string): void {
  if (!exactKeys(record, SOURCE_KEYS)
    || !record || record.organizationId !== request.organizationId
    || typeof record.sourceId !== "string" || !UUID.test(record.sourceId)
    || !UUID.test(actorId) || ![1, 2, 3].includes(record.revision)
    || !exactKeys(record.original, ["kind", "text"])
    || record.original.kind !== "typed-note"
    || record.original.text !== request.text
    || record.original.transcriptionSucceeded !== undefined
    || !Array.isArray(record.extractionAudit)
    || !record.creationAudit || Object.keys(record.creationAudit).length !== 3
    || record.creationAudit.actorId !== actorId
    || record.creationAudit.requestId !== request.requestId
    || record.creationAudit.textSha256 !== textSha256
    || !SHA.test(record.creationAudit.textSha256)
    || sha(record.original.text) !== textSha256) {
    throw new Error("Typed-note storage did not confirm the authorized immutable original");
  }
  if (record.revision === 1) {
    if (record.review !== null || record.extractionAudit.length !== 0
      || record.scopeReview !== null) {
      throw new Error("Unexpected processing state for a new typed note");
    }
    return;
  }
  const review = record.review;
  const audit = record.extractionAudit[0];
  if (!exactKeys(review, REVIEW_KEYS)
    || !review || !Array.isArray(review.candidates)
    || review.candidates.some(candidate => !exactKeys(candidate, CANDIDATE_KEYS))
    || record.extractionAudit.length !== 1 || !exactKeys(audit,
      ["sourceRevision", "actorId", "sourceSha256", "candidatesSha256"])
    || !audit
    || audit.sourceRevision !== 2 || !UUID.test(audit.actorId)
    || audit.sourceSha256 !== review.sourceSha256
    || audit.candidatesSha256 !== review.candidatesSha256) {
    throw new Error("Typed-note extraction progression is invalid");
  }
  // Every suggestion, including unselected suggestions, must refer to the
  // original bytes. A checksum alone never makes fabricated evidence valid.
  selectReviewedServices(record.original, review,
    review.candidates.map((_, index) => index));
  if (record.revision === 2) {
    if (record.scopeReview !== null) {
      throw new Error("Unexpected reviewed scope at extraction revision");
    }
    return;
  }
  const scope = record.scopeReview;
  const keys = ["sourceRevision", "reviewedBy", "reviewKey", "sourceSha256",
    "candidatesSha256", "selectedIndices", "acceptedAddonCodes",
    "policyRevision", "policySha256", "reviewedSelectionSha256", "state"];
  if (!scope || Object.keys(scope).length !== keys.length
    || keys.some(key => !Object.hasOwn(scope, key))
    || scope.state !== "reviewed-for-proposal-draft"
    || scope.sourceRevision !== 3 || !UUID.test(scope.reviewedBy)
    || !SHA.test(scope.reviewKey) || !SHA.test(scope.policySha256)
    || !SHA.test(scope.reviewedSelectionSha256)
    || !Number.isSafeInteger(scope.policyRevision) || scope.policyRevision < 1
    || scope.sourceSha256 !== review.sourceSha256
    || scope.candidatesSha256 !== review.candidatesSha256
    || !Array.isArray(scope.selectedIndices) || scope.selectedIndices.length === 0
    || !Array.isArray(scope.acceptedAddonCodes)
    || scope.acceptedAddonCodes.some(code => typeof code !== "string"
      || !/^[a-z][a-z0-9_-]{0,63}$/.test(code))
    || new Set(scope.acceptedAddonCodes).size !== scope.acceptedAddonCodes.length) {
    throw new Error("Typed-note reviewed scope progression is invalid");
  }
  const services = selectReviewedServices(record.original, review, scope.selectedIndices);
  if (scope.acceptedAddonCodes.some(code => !services.some(x => x.serviceCode === code))) {
    throw new Error("Reviewed add-on is not in the selected source scope");
  }
}

/** No customer-facing route, file access, transcription, extraction, pricing or
 * approval. Outcome remains eligible only for *later* human-review extraction.
 * A read-back exception means the create MAY already have committed: reconcile
 * by the trusted request ledger, not by making a new UUID and retrying blindly.
 */
export async function commitAuthorizedTypedNote(
  store: TrustedTypedNoteSourceStore,
  session: unknown,
  request: TypedNoteCreateRequest,
): Promise<
  | { state: "ready-for-extraction"; organizationId: string; sourceId: string; revision: 1; textSha256: string }
  | { state: "existing-source"; organizationId: string; sourceId: string; revision: 2 | 3; textSha256: string }
> {
  validateTypedNoteCreateRequest(request);
  const textSha256 = sha(request.text);
  const created = await store.createAuthorized({
    session, organizationId: request.organizationId,
    requestId: request.requestId, permission: "create-intake", textSha256,
    materialize: verified => build(request, textSha256,
      verified.sourceId, verified.authenticatedActorId),
  });
  if (!created || typeof created.authenticatedActorId !== "string") {
    throw new Error("Trusted typed-note create returned no verified actor");
  }
  verifyTypedNoteSourceRecord(created.record, request, textSha256, created.authenticatedActorId);
  const persisted = await store.readAuthorized({
    session, organizationId: request.organizationId,
    sourceId: created.record.sourceId,
  });
  verifyTypedNoteSourceRecord(persisted, request, textSha256, created.authenticatedActorId);
  // A provider response or replay may be false; compare the full data instead
  // of merely trusting the source UUID or a browser-supplied checksum.
  // PostgreSQL JSONB and adapters may reorder object keys. Compare the
  // complete structured record, not its serialization or field order.
  if (!isDeepStrictEqual(persisted, created.record)) {
    throw new Error("Typed-note read-back differs from authorized create result");
  }
  const base = { organizationId: request.organizationId,
    sourceId: created.record.sourceId, textSha256 };
  // A replay of a processed source does NOT authorize a second extraction.
  if (persisted!.revision === 1) {
    return { ...base, state: "ready-for-extraction", revision: 1 };
  }
  return { ...base, state: "existing-source", revision: persisted!.revision as 2 | 3 };
}
