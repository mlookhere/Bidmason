import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { snapshotTranscriptCorrectionRequest,
  type CorrectionCommitRequest, type TenantTranscriptRecord,
  type TrustedTranscriptCorrectionStore } from "./trusted-transcript-correction.ts";
import { prepareTranscriptCorrectionDraft } from "./transcript-clarification.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type CorrectionReconciliation =
  | { state: "confirmed"; sourceId: string; revision: number;
      correctionSha256: string; correctedBy: string }
  | { state: "unchanged-at-read"; sourceId: string }
  | { state: "conflict"; sourceId: string };

function snapshotSha(record: TenantTranscriptRecord): string {
  // Match the mutation contract's original snapshot fingerprint exactly.
  return createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.originalOutcome, record.activeSource, record.correctionAudit,
  ])).digest("hex");
}

/** Read-only reconciliation of an *indeterminate* correction outcome.
 * A trusted store MUST perform a fresh authenticated tenant-owned read from
 * the primary/linearizable source. No write, retry, send or grant occurs here.
 */
export async function reconcileTranscriptCorrection(
  store: Pick<TrustedTranscriptCorrectionStore, "readAuthorized">,
  session: unknown,
  request: CorrectionCommitRequest,
): Promise<CorrectionReconciliation> {
  const target = snapshotTranscriptCorrectionRequest(
    request, "Invalid correction reconciliation request");
  // Do not swallow denied access or missing records: callers may not mistake
  // loss of visibility for a confirmed rollback or permission to retry.
  const current = await store.readAuthorized({
    session, organizationId: target.organizationId, sourceId: target.sourceId,
  });
  if (!current || current.organizationId !== target.organizationId
    || current.sourceId !== target.sourceId
    || !Number.isSafeInteger(current.revision) || current.revision < 1
    || !Array.isArray(current.correctionAudit) || !current.originalOutcome) {
    throw new Error("Authorized correction record is unavailable or malformed");
  }
  // Authenticate the claimed original version even after a successful write:
  // the raw provider outcome must remain immutable in the authoritative store.
  const original: TenantTranscriptRecord = {
    ...current, revision: target.expectedRevision,
    activeSource: null, correctionAudit: [],
  };
  if (snapshotSha(original) !== target.expectedSnapshotSha256) {
    return { state: "conflict", sourceId: target.sourceId };
  }
  let draft: ReturnType<typeof prepareTranscriptCorrectionDraft>;
  try {
    draft = prepareTranscriptCorrectionDraft(current.originalOutcome, target.decisions);
  } catch {
    return { state: "conflict", sourceId: target.sourceId };
  }
  if (draft.correctionSha256 !== target.expectedCorrectionSha256) {
    return { state: "conflict", sourceId: target.sourceId };
  }
  if (current.revision === target.expectedRevision
    && current.activeSource === null && current.correctionAudit.length === 0) {
    // A single read does NOT prove a write cannot still arrive in the future.
    return { state: "unchanged-at-read", sourceId: target.sourceId };
  }
  if (target.expectedRevision >= Number.MAX_SAFE_INTEGER
    || current.revision !== target.expectedRevision + 1
    || current.correctionAudit.length !== 1) {
    return { state: "conflict", sourceId: target.sourceId };
  }
  const audit = current.correctionAudit[0];
  if (!audit || typeof audit.actorId !== "string" || !UUID.test(audit.actorId)) {
    return { state: "conflict", sourceId: target.sourceId };
  }
  const expectedAudit = {
    sourceRevision: current.revision,
    actorId: audit.actorId,
    audioSha256: draft.audioSha256,
    rawTranscriptSha256: draft.rawTranscriptSha256,
    correctedTranscriptSha256: draft.proposedTranscriptSha256,
    correctionSha256: draft.correctionSha256,
    changes: draft.corrections,
  };
  const expectedSource = {
    kind: "transcript", text: draft.proposedSource.text,
    transcriptionSucceeded: true,
  };
  if (!isDeepStrictEqual(audit, expectedAudit)
    || !isDeepStrictEqual(current.activeSource, expectedSource)) {
    return { state: "conflict", sourceId: target.sourceId };
  }
  return {
    state: "confirmed", sourceId: target.sourceId,
    revision: current.revision,
    correctionSha256: draft.correctionSha256,
    correctedBy: audit.actorId,
  };
}
