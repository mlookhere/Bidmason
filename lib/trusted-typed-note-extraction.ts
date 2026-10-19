import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseUntrustedExtraction } from "./intake-extraction-adapter.ts";
import { verifyTypedNoteSourceRecord,
  type TypedNoteSourceRecord } from "./tenant-typed-note-source.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const READ = `select record from bm_intake_private.read_typed_note_for_extraction(
  $1::uuid, $2::uuid, $3::uuid)`;
const COMMIT = `select source_revision, original_sha256, candidates_sha256
  from bm_intake_private.commit_typed_note_extraction(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb)`;

type Request = {
  session: unknown;
  organizationId: string;
  sourceId: string;
  rawExtractionResponse: string;
};

/** Disallow fake authority and SQL receipts before reading their values. */
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every(k => {
    const d = Object.getOwnPropertyDescriptor(value, k);
    return d?.enumerable === true && Object.hasOwn(d, "value");
  });
}
function oneRow(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length !== 1
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== 2) return false;
  const d = Object.getOwnPropertyDescriptor(value, "0");
  return d?.enumerable === true && Object.hasOwn(d, "value");
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function validateRequest(input: Request): void {
  if (!exact(input, ["session", "organizationId", "sourceId", "rawExtractionResponse"])
    || input.session === null || input.session === undefined
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
    || typeof input.sourceId !== "string" || !UUID.test(input.sourceId)
    || typeof input.rawExtractionResponse !== "string"
    || !input.rawExtractionResponse
    || Buffer.byteLength(input.rawExtractionResponse, "utf8") > 32768) {
    throw new TypeError("Invalid trusted extraction request");
  }
}

export type ExtractionReadOnlyReconciliation =
  | { state: "matching-extraction-at-read"; organizationId: string;
      sourceId: string; revision: 2 | 3; sourceSha256: string;
      candidatesSha256: string }
  | { state: "unprocessed-at-read"; organizationId: string; sourceId: string }
  | { state: "changed-during-read"; organizationId: string; sourceId: string }
  | { state: "different-extraction-at-read"; organizationId: string; sourceId: string };

/**
 * Staged server-only adapter; caller supplies approved implementations of both
 * ports. Neither this adapter nor the SQL files authenticate users on their
 * own. Never connect to a public PostgREST endpoint or a read replica.
 */
export function createTrustedTypedNoteExtraction(
  auth: ActiveSessionVerifier, db: PrivateIntakeDatabase,
) {
  async function actorFor(session: unknown): Promise<string> {
    const identity = await auth.verifyActiveSession(session);
    if (!exact(identity, ["userId"])
      || typeof identity.userId !== "string" || !UUID.test(identity.userId)) {
      throw new Error("Current verified Auth identity required for extraction");
    }
    return identity.userId;
  }

  async function readSource(
    session: unknown, organizationId: string, sourceId: string,
    expectedActor?: string,
  ): Promise<{actor: string; record: TypedNoteSourceRecord; textSha256: string}> {
    const actor = await actorFor(session);
    if (expectedActor && actor !== expectedActor) {
      throw new Error("Authenticated extractor identity changed");
    }
    // The private read checks current membership before source existence,
    // and restricts results to the original source creator.
    const response = await db.query(READ, [organizationId, actor, sourceId]);
    if (!response || !oneRow(response.rows)
      || !exact(response.rows[0], ["record"])) {
      throw new Error("Authorized typed-note source unavailable");
    }
    const record = response.rows[0].record as TypedNoteSourceRecord;
    if (!exact(record, ["organizationId", "sourceId", "revision", "original",
        "review", "extractionAudit", "scopeReview", "creationAudit"])
      || !exact(record.creationAudit, ["actorId", "requestId", "textSha256"])
      || !exact(record.original, ["kind", "text"])
      || typeof record.original.text !== "string"
      || record.organizationId !== organizationId
      || record.sourceId !== sourceId
      || record.creationAudit.actorId !== actor) {
      throw new Error("Typed-note identity or owner mismatch");
    }
    const textSha256 = digest(record.original.text);
    verifyTypedNoteSourceRecord(record, {
      organizationId, requestId:record.creationAudit.requestId,
      text:record.original.text,
    }, textSha256, actor);
    return {actor, record, textSha256};
  }

  return {
    /**
     * Only a typed note at revision 1 may advance to human extraction review.
     * Failures AFTER the CAS call are indeterminate; never replay it blindly.
     * This is not a quote, authorization, publication, or external send.
     */
    async commit(input: Request): Promise<{
      state: "needs-human-review"; organizationId: string; sourceId: string;
      revision: 2; sourceSha256: string; candidatesSha256: string;
    }> {
      validateRequest(input);
      // Authenticate and execute using the exact original request; the caller
      // can mutate its object while the provider/primary PostgreSQL awaits.
      const target: Request = {session:input.session,
        organizationId:input.organizationId, sourceId:input.sourceId,
        rawExtractionResponse:input.rawExtractionResponse};
      const {actor,record,textSha256} = await readSource(
        target.session, target.organizationId, target.sourceId,
      );
      if (record.revision !== 1) {
        throw new Error("Extraction source is stale or already reviewed");
      }
      // Parse only against the immutable original from primary PostgreSQL.
      // This validates every UTF-16 excerpt and calculates the canonical
      // candidates SHA; raw model/browser JSON is NEVER sent to SQL.
      const review = parseUntrustedExtraction(
        record.original, target.rawExtractionResponse,
      );
      if (!SHA.test(review.sourceSha256) || !SHA.test(review.candidatesSha256)) {
        throw new Error("Invalid extraction provenance");
      }
      if (await actorFor(target.session) !== actor) {
        throw new Error("Authenticated extractor identity changed");
      }
      const committed = await db.query(COMMIT, [
        target.organizationId, actor, target.sourceId,
        textSha256, JSON.stringify(review),
      ]);
      if (!committed || !oneRow(committed.rows)
        || !exact(committed.rows[0],
          ["source_revision", "original_sha256", "candidates_sha256"])
        || committed.rows[0].source_revision !== 2
        || committed.rows[0].original_sha256 !== textSha256
        || committed.rows[0].candidates_sha256 !== review.candidatesSha256) {
        throw new Error("Extraction CAS outcome is indeterminate");
      }

      // A new primary read must independently reauthorize membership and
      // confirm exactly the same immutable original and reviewed candidates.
      const checked = await readSource(
        target.session, target.organizationId, target.sourceId, actor,
      );
      if (checked.record.revision !== 2
        || checked.textSha256 !== textSha256
        || !isDeepStrictEqual(checked.record.review, review)
        || checked.record.extractionAudit[0]?.actorId !== actor) {
        throw new Error("Extraction CAS read-back is indeterminate");
      }
      return {
        state:"needs-human-review", organizationId:target.organizationId,
        sourceId:target.sourceId, revision:2,
        sourceSha256:review.sourceSha256,
        candidatesSha256:review.candidatesSha256,
      };
    },

    /**
     * READ ONLY inspection for an ambiguous extraction outcome. Two fresh
     * authorized primary reads, with no CAS/write/retry and no approval.
     *
     * "matching" only means matching evidence was present at both reads:
     * the prior ambiguous call is NOT proven to be its originating writer.
     * "unprocessed" is likewise never proof a competing writer cannot
     * commit after these observations. Callers must not retry blindly.
     */
    async reconcile(input: Request): Promise<ExtractionReadOnlyReconciliation> {
      validateRequest(input);
      const target: Request = {session:input.session,
        organizationId:input.organizationId, sourceId:input.sourceId,
        rawExtractionResponse:input.rawExtractionResponse};
      const first = await readSource(
        target.session, target.organizationId, target.sourceId,
      );
      // No browser-provided digest, raw source, actor or pricing data.
      const expected = parseUntrustedExtraction(
        first.record.original, target.rawExtractionResponse,
      );
      const second = await readSource(
        target.session, target.organizationId, target.sourceId, first.actor,
      );
      const selector = {
        organizationId:target.organizationId, sourceId:target.sourceId,
      };
      if (first.textSha256 !== second.textSha256
        || !isDeepStrictEqual(first.record, second.record)) {
        return {...selector, state:"changed-during-read"};
      }
      if (second.record.revision === 1) {
        return {...selector, state:"unprocessed-at-read"};
      }
      if (!isDeepStrictEqual(second.record.review, expected)
        || second.record.extractionAudit[0]?.actorId !== first.actor) {
        return {...selector, state:"different-extraction-at-read"};
      }
      return {
        ...selector, state:"matching-extraction-at-read",
        revision:second.record.revision as 2 | 3,
        sourceSha256:expected.sourceSha256,
        candidatesSha256:expected.candidatesSha256,
      };
    },
  };
}
