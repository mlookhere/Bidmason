import { createHash } from "node:crypto";
import type { TenantServiceReviewRecord } from "./tenant-service-review.ts";

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
 * reused request ID. For new requests the adapter allocates sourceId on the
 * server and invokes materialize exactly once inside that transaction.
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

function validateInput(request: TypedNoteCreateRequest): void {
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

function verify(record: TypedNoteSourceRecord | null,
  request: TypedNoteCreateRequest, textSha256: string, actorId: string): void {
  if (!record || record.organizationId !== request.organizationId
    || typeof record.sourceId !== "string" || !UUID.test(record.sourceId)
    || !UUID.test(actorId) || record.revision !== 1
    || !record.original || record.original.kind !== "typed-note"
    || record.original.text !== request.text
    || record.original.transcriptionSucceeded !== undefined
    || record.review !== null
    || !Array.isArray(record.extractionAudit) || record.extractionAudit.length !== 0
    || record.scopeReview !== null
    || !record.creationAudit
    || Object.keys(record.creationAudit).length !== 3
    || record.creationAudit.actorId !== actorId
    || record.creationAudit.requestId !== request.requestId
    || record.creationAudit.textSha256 !== textSha256
    || !SHA.test(record.creationAudit.textSha256)
    || sha(record.original.text) !== textSha256) {
    throw new Error("Typed-note storage did not confirm the authorized immutable original");
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
): Promise<{ state: "ready-for-extraction";
  organizationId: string; sourceId: string; revision: 1;
  textSha256: string }> {
  validateInput(request);
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
  verify(created.record, request, textSha256, created.authenticatedActorId);
  const persisted = await store.readAuthorized({
    session, organizationId: request.organizationId,
    sourceId: created.record.sourceId,
  });
  verify(persisted, request, textSha256, created.authenticatedActorId);
  // A provider response or replay may be false; compare the full data instead
  // of merely trusting the source UUID or a browser-supplied checksum.
  if (JSON.stringify(persisted) !== JSON.stringify(created.record)) {
    throw new Error("Typed-note read-back differs from authorized create result");
  }
  return {
    state: "ready-for-extraction", organizationId: request.organizationId,
    sourceId: created.record.sourceId, revision: 1, textSha256,
  };
}
