import { createHash } from "node:crypto";
import { validateIntakeSource, selectReviewedServices,
  type IntakeSource, type ExtractionReview } from "./intake-review.ts";
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
  /** Optional on the tenant-owned superset; never trust for extraction. */
  creationAudit?: unknown;
  scopeReview?: unknown;
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

/** These are authority-bearing JSON values: no inherited, hidden, symbol
 * or accessor properties may be interpreted as valid selectors. */
function exactData(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return d?.enumerable === true && Object.hasOwn(d, "value");
  });
}

function selector(input: Selector, keys: readonly string[] =
  ["organizationId", "sourceId"]): void {
  if (!exactData(input, keys)
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
    || !Object.hasOwn(record, "review")
    || !Array.isArray(record.extractionAudit)
    || record.extractionAudit.length > 1) {
    throw new Error("Tenant-owned extraction source missing or invalid");
  }
  try {
    validateIntakeSource(record.original);
    // An extraction cannot be both "not yet reviewed" and audit-complete.
    // Do not infer absence when a backend omitted the review property.
    if (record.review === null) {
      if (record.extractionAudit.length !== 0
        || (record.scopeReview !== null && record.scopeReview !== undefined)) {
        throw new Error("Inconsistent unreviewed source");
      }
      return;
    }
    const review = record.review;
    const audit = record.extractionAudit[0];
    if (!audit || record.extractionAudit.length !== 1
      || Object.keys(audit).length !== 4
      || !["sourceRevision", "actorId", "sourceSha256", "candidatesSha256"]
        .every(key => Object.hasOwn(audit, key))
      || !Number.isSafeInteger(audit.sourceRevision)
      || audit.sourceRevision < 2 || audit.sourceRevision > record.revision
      || typeof audit.actorId !== "string" || !UUID.test(audit.actorId)
      || audit.sourceSha256 !== review.sourceSha256
      || audit.candidatesSha256 !== review.candidatesSha256) {
      throw new Error("Inconsistent extraction audit");
    }
    // Verify ALL suggested evidence, not just the selected candidates.
    selectReviewedServices(record.original, review,
      review.candidates.map((_, index) => index));
  } catch {
    throw new Error("Tenant-owned extraction source missing or invalid");
  }
}

function fingerprint(record: TenantExtractionRecord): string {
  // Consistency marker only: NOT authentication, RLS or a signature.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review, record.extractionAudit,
    record.creationAudit ?? null, record.scopeReview ?? null,
  ])).digest("hex");
}

/** A source-owned unreviewed record; no candidate or policy can be activated. */
export async function readExtractionPreparation(
  store: TrustedExtractionStore, session: unknown, input: Selector,
): Promise<{ state: "ready-for-extraction"; organizationId: string;
  sourceId: string; expectedRevision: number; expectedSnapshotSha256: string }> {
  selector(input);
  const target: Selector = {
    organizationId: input.organizationId, sourceId: input.sourceId,
  };
  const current = await store.readAuthorized({ ...target, session });
  checkRecord(current, target);
  if (current.review || current.extractionAudit.length > 0) {
    throw new Error("Extraction snapshot has already been committed");
  }
  return {
    state: "ready-for-extraction", ...target,
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
  selector(request, ["organizationId", "sourceId", "expectedRevision",
    "expectedSnapshotSha256", "rawExtractionResponse"]);
  if (!Number.isSafeInteger(request.expectedRevision)
    || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.rawExtractionResponse !== "string"
    || request.rawExtractionResponse.length === 0
    || Buffer.byteLength(request.rawExtractionResponse, "utf8") > 32768) {
    throw new TypeError("Invalid untrusted extraction commit request");
  }
  // Validate the model response and bind every requested CAS field before
  // awaiting the database. Mutating caller data cannot retarget the write.
  const target: ExtractionCommitRequest = {
    organizationId: request.organizationId, sourceId: request.sourceId,
    expectedRevision: request.expectedRevision,
    expectedSnapshotSha256: request.expectedSnapshotSha256,
    rawExtractionResponse: request.rawExtractionResponse,
  };
  const prepared: {record: TenantExtractionRecord | null} = {record:null};
  const committed = await store.mutateAuthorized({
    organizationId: target.organizationId,
    sourceId: target.sourceId, session, permission:"extract",
    transform(current, authenticatedActorId) {
      checkRecord(current, target);
      if (typeof authenticatedActorId !== "string"
        || !UUID.test(authenticatedActorId)) {
        throw new Error("Verified extraction operator identity required");
      }
      if (current.revision !== target.expectedRevision
        || fingerprint(current) !== target.expectedSnapshotSha256) {
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
      const review = parseUntrustedExtraction(current.original, target.rawExtractionResponse);
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
  // An invalid adapter acknowledgement is a failed confirmation, never
  // evidence of a rollback or an accepted extraction.
  try {
    checkRecord(committed, target);
  } catch {
    throw new Error("Extraction write did not confirm authorized transition");
  }
  if (!prepared.record || fingerprint(committed) !== fingerprint(prepared.record)) {
    throw new Error("Extraction write did not confirm authorized transition");
  }
  // Require the current authorized primary, not an eventual-consistency replica.
  // Failure here is indeterminate: transaction may already have committed.
  const stored = await store.readAuthorized({
    organizationId:target.organizationId, sourceId:target.sourceId, session,
  });
  try {
    checkRecord(stored, target);
  } catch {
    throw new Error("Extraction committed record not confirmed by read-back");
  }
  if (fingerprint(stored) !== fingerprint(prepared.record)) {
    throw new Error("Extraction committed record not confirmed by read-back");
  }
  const review = stored.review!;
  return {
    state:"needs-human-review", sourceId:target.sourceId,
    revision:stored.revision, sourceSha256:review.sourceSha256,
    candidatesSha256:review.candidatesSha256,
  };
}
