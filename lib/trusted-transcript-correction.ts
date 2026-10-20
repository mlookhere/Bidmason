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

/** Reject non-data directives before reading authorization identifiers. */
function exactFields(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return d?.enumerable === true && Object.hasOwn(d, "value");
  });
}
function checkSelector(input: Selector, fields: readonly string[] =
  ["organizationId", "sourceId"]): void {
  if (!exactFields(input, fields)
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
    || typeof input.sourceId !== "string" || !UUID.test(input.sourceId)) {
    throw new TypeError("Invalid tenant transcript selector");
  }
}

function snapshotDecisions(input: TranscriptClarification[]): TranscriptClarification[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50
    || Object.getPrototypeOf(input) !== Array.prototype
    || Reflect.ownKeys(input).length !== input.length + 1) {
    throw new TypeError("Invalid transcript correction decisions");
  }
  const decisions: TranscriptClarification[] = [];
  for (let i = 0; i < input.length; i++) {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (d?.enumerable !== true || !Object.hasOwn(d, "value")
      || !exactFields(d.value, ["uncertaintyIndex", "replacement", "explanation"])) {
      throw new TypeError("Invalid transcript correction decisions");
    }
    const row = d.value as TranscriptClarification;
    if (!Number.isSafeInteger(row.uncertaintyIndex) || row.uncertaintyIndex < 0
      || typeof row.replacement !== "string" || row.replacement.length > 512
      || typeof row.explanation !== "string" || row.explanation.length > 500) {
      throw new TypeError("Invalid transcript correction decisions");
    }
    decisions.push({uncertaintyIndex: row.uncertaintyIndex,
      replacement: row.replacement, explanation: row.explanation});
  }
  return decisions;
}

/** Detached, data-only caller intent for both CAS and read-only recovery. */
export function snapshotTranscriptCorrectionRequest(
  request: CorrectionCommitRequest,
  message = "Invalid transcript correction request",
): CorrectionCommitRequest {
  const names = ["organizationId", "sourceId", "expectedRevision",
    "expectedSnapshotSha256", "expectedCorrectionSha256", "decisions"];
  if (!exactFields(request, names)
    || typeof request.organizationId !== "string" || !UUID.test(request.organizationId)
    || typeof request.sourceId !== "string" || !UUID.test(request.sourceId)
    || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1
    || typeof request.expectedSnapshotSha256 !== "string"
    || !HASH.test(request.expectedSnapshotSha256)
    || typeof request.expectedCorrectionSha256 !== "string"
    || !HASH.test(request.expectedCorrectionSha256)) {
    throw new TypeError(message);
  }
  let decisions: TranscriptClarification[];
  try {
    decisions = snapshotDecisions(request.decisions);
  } catch {
    throw new TypeError(message);
  }
  return {organizationId:request.organizationId, sourceId:request.sourceId,
    expectedRevision:request.expectedRevision,
    expectedSnapshotSha256:request.expectedSnapshotSha256,
    expectedCorrectionSha256:request.expectedCorrectionSha256,
    decisions};
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
  const target: Selector = {organizationId:selector.organizationId,
    sourceId:selector.sourceId};
  const current = await store.readAuthorized({...target, session});
  checkRecord(current, target);
  if (current.activeSource || current.correctionAudit.length !== 0) {
    throw new Error("Transcript correction has already been committed");
  }
  const questions = listTranscriptClarifications(current.originalOutcome);
  if (current.originalOutcome.state === "failed") {
    throw new Error("Failed transcription cannot be corrected");
  }
  return {
    state: "requires-human-clarification" as const,
    organizationId: target.organizationId,
    sourceId: target.sourceId,
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
  const target = snapshotTranscriptCorrectionRequest(request);
  // Capture the only transition approved by this trusted callback. A backend
  // response alone is not proof that this transition was durably committed.
  const prepared: { record: TenantTranscriptRecord | null } = { record: null };
  const committed = await store.mutateAuthorized({
    session, organizationId: target.organizationId, sourceId: target.sourceId,
    permission: "correct-transcript",
    transform: (current, actorId) => {
      checkRecord(current, target);
      if (typeof actorId !== "string" || !UUID.test(actorId)) {
        throw new Error("Authenticated reviewer identity required");
      }
      if (current.revision !== target.expectedRevision
        || fingerprint(current) !== target.expectedSnapshotSha256) {
        throw new Error("Stale transcript revision; reload correction review");
      }
      if (current.activeSource || current.correctionAudit.length !== 0) {
        throw new Error("Transcript correction has already been committed");
      }
      // Recompute every source span and every correction from the stored
      // original. Never accept browser-generated corrected text or audit data.
      const draft = prepareTranscriptCorrectionDraft(
        current.originalOutcome, target.decisions);
      if (draft.correctionSha256 !== target.expectedCorrectionSha256) {
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
  checkRecord(committed, target);
  const audit = committed.correctionAudit[0];
  if (!prepared.record || committed.revision !== target.expectedRevision + 1
    || !audit || audit.sourceRevision !== committed.revision
    || audit.correctionSha256 !== target.expectedCorrectionSha256
    || !committed.activeSource || !committed.activeSource.transcriptionSucceeded
    || fingerprint(committed) !== fingerprint(prepared.record)) {
    throw new Error("Trusted transcript persistence did not confirm commit");
  }
  // A successful mutation response can be fabricated or lost. Require a fresh,
  // currently authorized, primary/linearizable read of the exact committed
  // source revision and audit before reporting a confirmed correction. If ACLs
  // change immediately after the write, fail closed without claiming success.
  const stored = await store.readAuthorized({
    session, organizationId: target.organizationId, sourceId: target.sourceId,
  });
  checkRecord(stored, target);
  if (fingerprint(stored) !== fingerprint(prepared.record)) {
    throw new Error("Trusted transcript read-back does not match committed correction");
  }
  return {
    state: "corrected-for-human-review", sourceId: target.sourceId,
    revision: committed.revision, correctionSha256: audit.correctionSha256,
    correctedBy: audit.actorId,
  };
}
