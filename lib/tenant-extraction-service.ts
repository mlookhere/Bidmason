import { createHash } from "node:crypto";
import type { IntakeSource, ExtractionReview } from "./intake-review.ts";
import { parseUntrustedExtraction } from "./intake-extraction-adapter.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

export type ExtractionAudit = {
  sourceRevision: number;
  actorId: string;
  sourceSha256: string;
  candidatesSha256: string;
};

export type TenantExtractionRecord = {
  organizationId: string;
  sourceId: string;
  revision: number;
  original: IntakeSource;
  review: ExtractionReview | null;
  extractionAudit: ExtractionAudit[];
};

/** Implement with a trusted, atomic tenant-scoped database transaction.
 * Current session, organization membership, source ownership, permissions
 * and revision CAS MUST all be checked inside the same write transaction.
 * The callback MUST NOT receive a client-declared actor or organization role. */
export interface TrustedExtractionStore {
  readAuthorized(input: {
    organizationId: string; sourceId: string; session: unknown;
  }): Promise<TenantExtractionRecord | null>;
  mutateAuthorized(input: {
    organizationId: string; sourceId: string; session: unknown;
    permission: "extract";
    transform: (current: TenantExtractionRecord | null,
      authenticatedActorId: string) => TenantExtractionRecord;
  }): Promise<TenantExtractionRecord>;
}

type Selector = { organizationId: string; sourceId: string };

function selector(input: Selector): void {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
    || typeof input.sourceId !== "string" || !UUID.test(input.sourceId)) {
    throw new TypeError("Invalid tenant extraction selector");
  }
}

function checkRecord(record: TenantExtractionRecord | null, input: Selector):
  asserts record is TenantExtractionRecord {
  if (!record || record.organizationId !== input.organizationId
    || record.sourceId !== input.sourceId
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !record.original || typeof record.original.text !== "string"
    || !["typed-note", "transcript"].includes(record.original.kind)
    || record.original.text.trim().length === 0
    || Buffer.byteLength(record.original.text, "utf8") > 65536
    || (record.original.kind === "transcript"
       && record.original.transcriptionSucceeded !== true)
    || (record.review !== null && record.review !== undefined
      && (record.review.state !== "needs-human-review"
        || record.review.kind !== record.original.kind))
    || !Array.isArray(record.extractionAudit)
    || record.extractionAudit.length > 1) {
    throw new Error("Tenant-owned extraction source missing or invalid");
  }
}

function fingerprint(record: TenantExtractionRecord): string {
  // Consistency marker only: NOT authentication, RLS or a signature.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review, record.extractionAudit,
  ])).digest("hex");
}

/** A source-owned unreviewed record; no candidate or policy can be activated. */
export async function readExtractionPreparation(
  store: TrustedExtractionStore, session: unknown, input: Selector,
): Promise<{ state: "ready-for-extraction"; organizationId: string;
  sourceId: string; expectedRevision: number; expectedSnapshotSha256: string }> {
  selector(input);
  const current = await store.readAuthorized({ ...input, session });
  checkRecord(current, input);
  if (current.review || current.extractionAudit.length > 0) {
    throw new Error("Extraction snapshot has already been committed");
  }
  return {
    state: "ready-for-extraction", ...input,
    expectedRevision: current.revision,
    expectedSnapshotSha256: fingerprint(current),
  };
}

export type ExtractionCommitRequest = Selector & {
  expectedRevision: number;
  expectedSnapshotSha256: string;
  rawExtractionResponse: string;
};

/** Server-only commit. Always parse the untrusted model response against the
 * exact ORIGINAL read in the authorized transaction, never browser text.
 * Result is human review only and CANNOT approve prices or send a proposal. */
export async function commitAuthorizedExtraction(
  store: TrustedExtractionStore, session: unknown, request: ExtractionCommitRequest,
): Promise<{ state: "needs-human-review"; sourceId: string;
  revision: number; sourceSha256: string; candidatesSha256: string }> {
  selector(request);
  if (!request || Object.keys(request).length !== 5
    || ["organizationId", "sourceId", "expectedRevision",
        "expectedSnapshotSha256", "rawExtractionResponse"]
      .some(key => !Object.hasOwn(request, key))
    || !Number.isSafeInteger(request.expectedRevision)
    || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.rawExtractionResponse !== "string"
    || request.rawExtractionResponse.length === 0
    || Buffer.byteLength(request.rawExtractionResponse, "utf8") > 32768) {
    throw new TypeError("Invalid untrusted extraction commit request");
  }
  const prepared: {record: TenantExtractionRecord | null} = {record:null};
  const committed = await store.mutateAuthorized({
    organizationId: request.organizationId,
    sourceId: request.sourceId, session, permission:"extract",
    transform(current, authenticatedActorId) {
      checkRecord(current, request);
      if (typeof authenticatedActorId !== "string"
        || !UUID.test(authenticatedActorId)) {
        throw new Error("Verified extraction operator identity required");
      }
      if (current.revision !== request.expectedRevision
        || fingerprint(current) !== request.expectedSnapshotSha256) {
        throw new Error("Stale extraction source revision");
      }
      if (current.review || current.extractionAudit.length !== 0) {
        throw new Error("Extraction review has already been committed");
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Extraction revision overflow");
      }
      // Parse inside the locked CAS against the stored original. The extractor
      // cannot provide prices, an approval flag, or arbitrary source contents.
      const review = parseUntrustedExtraction(current.original, request.rawExtractionResponse);
      const nextRevision = current.revision + 1;
      const next: TenantExtractionRecord = {
        ...current, revision:nextRevision, review,
        extractionAudit:[{
          sourceRevision:nextRevision, actorId:authenticatedActorId,
          sourceSha256:review.sourceSha256,
          candidatesSha256:review.candidatesSha256,
        }],
      };
      prepared.record = structuredClone(next);
      return next;
    },
  });
  checkRecord(committed, request);
  if (!prepared.record || fingerprint(committed) !== fingerprint(prepared.record)) {
    throw new Error("Extraction write did not confirm authorized transition");
  }
  // Require the current authorized primary, not an eventual-consistency replica.
  // Failure here is indeterminate: transaction may already have committed.
  const stored = await store.readAuthorized({
    organizationId:request.organizationId, sourceId:request.sourceId, session,
  });
  checkRecord(stored, request);
  if (fingerprint(stored) !== fingerprint(prepared.record)) {
    throw new Error("Extraction committed record not confirmed by read-back");
  }
  const review = stored.review!;
  return {
    state:"needs-human-review", sourceId:request.sourceId,
    revision:stored.revision, sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
  };
}
