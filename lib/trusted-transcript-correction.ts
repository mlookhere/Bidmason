import { createHash } from "node:crypto";
import type { TranscriptionOutcome } from "./audio-transcription.ts";
import type { IntakeSource } from "./intake-review.ts";
import { listTranscriptClarifications, prepareTranscriptCorrectionDraft,
  type TranscriptClarification, type TranscriptCorrectionRecord }
  from "./transcript-clarification.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

export type CorrectionAudit = {
  sourceRevision: number;
  actorId: string;
  audioSha256: string;
  rawTranscriptSha256: string;
  correctedTranscriptSha256: string;
  correctionSha256: string;
  changes: TranscriptCorrectionRecord[];
};

export type TenantTranscriptRecord = {
  organizationId: string;
  sourceId: string;
  revision: number;
  originalOutcome: TranscriptionOutcome;
  activeSource: IntakeSource | null;
  correctionAudit: CorrectionAudit[];
};

type Selector = {organizationId: string; sourceId: string};

/** Production implementation MUST lock the source row and re-check current
 * membership, source ownership and correct-transcript role INSIDE the same
 * database transaction that commits the updated source plus append-only audit.
 * No client-provided actor ID or role may cross this boundary. */
export interface TrustedTranscriptCorrectionStore {
  readAuthorized(input: Selector & {session: unknown}): Promise<TenantTranscriptRecord | null>;
  mutateAuthorized(input: Selector & {
    session: unknown;
    permission: "correct-transcript";
    transform: (current: TenantTranscriptRecord | null,
      authenticatedActorId: string) => TenantTranscriptRecord;
  }): Promise<TenantTranscriptRecord>;
}

function checkSelector(selector: Selector): void {
  if (!selector || typeof selector !== "object"
    || !UUID.test(selector.organizationId) || !UUID.test(selector.sourceId)) {
    throw new TypeError("Invalid tenant transcript selector");
  }
}

function checkRecord(record: TenantTranscriptRecord | null, selector: Selector):
  asserts record is TenantTranscriptRecord {
  if (!record || record.organizationId !== selector.organizationId
    || record.sourceId !== selector.sourceId
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !Array.isArray(record.correctionAudit)
    || record.correctionAudit.length > 1
    || (record.activeSource !== null && record.activeSource !== undefined)
       && (record.activeSource.kind !== "transcript"
         || record.activeSource.transcriptionSucceeded !== true)
    || !record.originalOutcome) {
    throw new Error("Tenant transcript record missing or invalid");
  }
}

function fingerprint(record: TenantTranscriptRecord): string {
  // Consistency checksum, never a server signature, grant or approval.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.originalOutcome, record.activeSource, record.correctionAudit,
  ])).digest("hex");
}

export async function readTranscriptCorrectionContext(
  store: TrustedTranscriptCorrectionStore,
  session: unknown,
  selector: Selector,
) {
  checkSelector(selector);
  const current = await store.readAuthorized({...selector, session});
  checkRecord(current, selector);
  if (current.activeSource || current.correctionAudit.length !== 0) {
    throw new Error("Transcript correction has already been committed");
  }
  const questions = listTranscriptClarifications(current.originalOutcome);
  if (current.originalOutcome.state === "failed") {
    throw new Error("Failed transcription cannot be corrected");
  }
  return {
    state: "requires-human-clarification" as const,
    organizationId: selector.organizationId,
    sourceId: selector.sourceId,
    expectedRevision: current.revision,
    expectedSnapshotSha256: fingerprint(current),
    originalText: current.originalOutcome.original.text,
    questions,
  };
}

export type CorrectionCommitRequest = Selector & {
  expectedRevision: number;
  expectedSnapshotSha256: string;
  expectedCorrectionSha256: string;
  decisions: TranscriptClarification[];
};

/** Called only by an internal authenticated server. The write adapter must
 * commit the source and correction audit atomically under a current ACL check.
 * The corrected source is extraction-eligible ONLY after that durable commit;
 * this never authorizes commercial pricing, proposal release or sending. */
export async function commitAuthorizedTranscriptCorrection(
  store: TrustedTranscriptCorrectionStore,
  session: unknown,
  request: CorrectionCommitRequest,
): Promise<{state:"corrected-for-human-review"; sourceId:string;
  revision:number; correctionSha256:string; correctedBy:string}> {
  checkSelector(request);
  if (!request || Object.keys(request).length !== 6
    || ["organizationId", "sourceId", "expectedRevision",
      "expectedSnapshotSha256", "expectedCorrectionSha256", "decisions"]
      .some(key => !Object.hasOwn(request, key))
    || !Number.isSafeInteger(request.expectedRevision)
    || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.expectedCorrectionSha256 !== "string"
    || !HASH.test(request.expectedCorrectionSha256)
    || !Array.isArray(request.decisions)) {
    throw new TypeError("Invalid transcript correction request");
  }
  // Capture the only transition approved by this trusted callback. A backend
  // response alone is not proof that this transition was durably committed.
  const prepared: { record: TenantTranscriptRecord | null } = { record: null };
  const committed = await store.mutateAuthorized({
    session, organizationId: request.organizationId, sourceId: request.sourceId,
    permission: "correct-transcript",
    transform: (current, actorId) => {
      checkRecord(current, request);
      if (typeof actorId !== "string" || !UUID.test(actorId)) {
        throw new Error("Authenticated reviewer identity required");
      }
      if (current.revision !== request.expectedRevision
        || fingerprint(current) !== request.expectedSnapshotSha256) {
        throw new Error("Stale transcript revision; reload correction review");
      }
      if (current.activeSource || current.correctionAudit.length !== 0) {
        throw new Error("Transcript correction has already been committed");
      }
      // Recompute every source span and every correction from the stored
      // original. Never accept browser-generated corrected text or audit data.
      const draft = prepareTranscriptCorrectionDraft(
        current.originalOutcome, request.decisions);
      if (draft.correctionSha256 !== request.expectedCorrectionSha256) {
        throw new Error("Transcript correction draft changed; review again");
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Transcript revision overflow");
      }
      const nextRevision = current.revision + 1;
      const audit: CorrectionAudit = {
        sourceRevision: nextRevision, actorId,
        audioSha256: draft.audioSha256,
        rawTranscriptSha256: draft.rawTranscriptSha256,
        correctedTranscriptSha256: draft.proposedTranscriptSha256,
        correctionSha256: draft.correctionSha256,
        changes: draft.corrections,
      };
      const next: TenantTranscriptRecord = {
        ...current, revision: nextRevision,
        activeSource: {
          kind: "transcript", text: draft.proposedSource.text,
          transcriptionSucceeded: true,
        },
        correctionAudit: [...current.correctionAudit, audit],
      };
      // Snapshot expected bytes before any adapter can mutate the output.
      prepared.record = structuredClone(next);
      return next;
    },
  });
  checkRecord(committed, request);
  const audit = committed.correctionAudit[0];
  if (!prepared.record || committed.revision !== request.expectedRevision + 1
    || !audit || audit.sourceRevision !== committed.revision
    || audit.correctionSha256 !== request.expectedCorrectionSha256
    || !committed.activeSource || !committed.activeSource.transcriptionSucceeded
    || fingerprint(committed) !== fingerprint(prepared.record)) {
    throw new Error("Trusted transcript persistence did not confirm commit");
  }
  // A successful mutation response can be fabricated or lost. Require a fresh,
  // currently authorized, primary/linearizable read of the exact committed
  // source revision and audit before reporting a confirmed correction. If ACLs
  // change immediately after the write, fail closed without claiming success.
  const stored = await store.readAuthorized({
    session, organizationId: request.organizationId, sourceId: request.sourceId,
  });
  checkRecord(stored, request);
  if (fingerprint(stored) !== fingerprint(prepared.record)) {
    throw new Error("Trusted transcript read-back does not match committed correction");
  }
  return {
    state: "corrected-for-human-review", sourceId: request.sourceId,
    revision: committed.revision, correctionSha256: audit.correctionSha256,
    correctedBy: audit.actorId,
  };
}
