import type { TrustedTypedNoteLedger } from "./typed-note-reconciliation.ts";
import type { TypedNoteSourceRecord } from "./tenant-typed-note-source.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const LOOKUP = `select authenticated_actor_id, text_sha256, record
  from bm_intake_private.lookup_typed_note($1::uuid, $2::uuid, $3::uuid)`;

/**
 * SERVER-ONLY integration port. Implementations must verify the actual,
 * non-revoked Supabase Auth session on EACH invocation. In particular, the
 * userId must not be read from a client-supplied JSON field or cached identity.
 */
export interface ActiveSessionVerifier {
  verifyActiveSession(session: unknown): Promise<{ userId: string }>;
}

/**
 * Connection must target primary PostgreSQL with a server-held service role.
 * No public PostgREST RPC, browser driver or replica-backed result is allowed.
 * The private SECURITY INVOKER SQL function independently checks and locks
 * current membership, including on an absent idempotency key.
 */
export interface PrivateIntakeDatabase {
  query(sql: string, params: readonly string[]): Promise<{ rows: unknown[] }>;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

/**
 * Maps a verified current server Auth identity to the staged read-only SQL
 * receipt primitive. Never reconstruct a note from client data or retry writes.
 * This module does NOT implement Auth verification, connect to a live database,
 * or enable uploads, proposals, approvals or customer-facing routes.
 */
export function createTrustedTypedNoteLedger(
  auth: ActiveSessionVerifier,
  database: PrivateIntakeDatabase,
): TrustedTypedNoteLedger {
  async function currentActor(session: unknown): Promise<string> {
    const identity = await auth.verifyActiveSession(session);
    if (!exactObject(identity, ["userId"])
      || typeof identity.userId !== "string" || !UUID.test(identity.userId)) {
      throw new Error("Verified active Auth identity required");
    }
    return identity.userId;
  }
  return {
    async lookupAuthorized(input) {
      if (!exactObject(input, ["organizationId", "requestId", "session", "permission"])
        || input.permission !== "create-intake"
        || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
        || typeof input.requestId !== "string" || !UUID.test(input.requestId)) {
        throw new TypeError("Invalid private typed-note lookup");
      }
      // Treat the opaque session only as an input to a trusted verifier. Never
      // inspect userId, actorId, role or tenant fields on the session object.
      const actor = await currentActor(input.session);
      const result = await database.query(LOOKUP, [
        input.organizationId, actor, input.requestId,
      ]);
      if (!result || typeof result !== "object" || !Array.isArray(result.rows)
        || result.rows.length > 1) {
        throw new Error("Invalid primary intake lookup result");
      }
      // A session can expire or be revoked while the primary read is in
      // flight. Reauthenticate before disclosing a receipt OR its absence.
      if (await currentActor(input.session) !== actor) {
        throw new Error("Authenticated intake actor changed during lookup");
      }
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      if (!exactObject(row, ["authenticated_actor_id", "text_sha256", "record"])
        || row.authenticated_actor_id !== actor
        || typeof row.text_sha256 !== "string" || !SHA.test(row.text_sha256)
        || !row.record || typeof row.record !== "object"
        || Array.isArray(row.record)) {
        throw new Error("Private intake ledger identity or evidence mismatch");
      }
      // The upstream reconciliation validates the entire original and
      // lifecycle record, including SHA-256 and absence of forged fields.
      return {
        authenticatedActorId: actor,
        textSha256: row.text_sha256,
        record: row.record as TypedNoteSourceRecord,
      };
    },
  };
}
