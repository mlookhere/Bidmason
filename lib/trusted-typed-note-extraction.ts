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

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(k => Object.hasOwn(value, k));
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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
    if (!response || !Array.isArray(response.rows) || response.rows.length !== 1
      || !exact(response.rows[0], ["record"])) {
      throw new Error("Authorized typed-note source unavailable");
    }
    const record = response.rows[0].record as TypedNoteSourceRecord;
    if (!record || record.organizationId !== organizationId
      || record.sourceId !== sourceId || !record.creationAudit
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
      if (!exact(input, ["session", "organizationId", "sourceId", "rawExtractionResponse"])
        || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
        || typeof input.sourceId !== "string" || !UUID.test(input.sourceId)
        || typeof input.rawExtractionResponse !== "string"
        || !input.rawExtractionResponse
        || Buffer.byteLength(input.rawExtractionResponse, "utf8") > 32768) {
        throw new TypeError("Invalid trusted extraction request");
      }
      const {actor,record,textSha256} = await readSource(
        input.session, input.organizationId, input.sourceId,
      );
      if (record.revision !== 1) {
        throw new Error("Extraction source is stale or already reviewed");
      }
      // Parse only against the immutable original from primary PostgreSQL.
      // This validates every UTF-16 excerpt and calculates the canonical
      // candidates SHA; raw model/browser JSON is NEVER sent to SQL.
      const review = parseUntrustedExtraction(
        record.original, input.rawExtractionResponse,
      );
      if (!SHA.test(review.sourceSha256) || !SHA.test(review.candidatesSha256)) {
        throw new Error("Invalid extraction provenance");
      }
      if (await actorFor(input.session) !== actor) {
        throw new Error("Authenticated extractor identity changed");
      }
      const committed = await db.query(COMMIT, [
        input.organizationId, actor, input.sourceId,
        textSha256, JSON.stringify(review),
      ]);
      if (!committed || !Array.isArray(committed.rows)
        || committed.rows.length !== 1
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
        input.session, input.organizationId, input.sourceId, actor,
      );
      if (checked.record.revision !== 2
        || checked.textSha256 !== textSha256
        || !isDeepStrictEqual(checked.record.review, review)
        || checked.record.extractionAudit[0]?.actorId !== actor) {
        throw new Error("Extraction CAS read-back is indeterminate");
      }
      return {
        state:"needs-human-review", organizationId:input.organizationId,
        sourceId:input.sourceId, revision:2,
        sourceSha256:review.sourceSha256,
        candidatesSha256:review.candidatesSha256,
      };
    },
  };
}
