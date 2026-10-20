import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const INSPECT = `select observation, persisted_revision, observed_selection_sha256
  from bm_intake_private.inspect_typed_note_scope_commit(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text)`;

type ScopeSelector = {
  session: unknown;
  organizationId: string;
  sourceId: string;
  sourceSha256: string;
  candidatesSha256: string;
  reviewedSelectionSha256: string;
};

type ScopeState = "unreviewed-at-read" | "matching-scope-at-read"
  | "different-scope-at-read" | "matching-stale-policy-at-read";

export type TrustedScopeReconciliation =
  | {state: ScopeState; organizationId: string; sourceId: string;
      persistedRevision: 2 | 3; observedSelectionSha256: string | null}
  | {state: "changed-during-read"; organizationId: string; sourceId: string};

/** A recovery observation is never a quote, policy approval, or retry permit. */
function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function checkSelector(selector: ScopeSelector): void {
  if (!exactObject(selector, ["session","organizationId","sourceId",
    "sourceSha256","candidatesSha256","reviewedSelectionSha256"])
    || typeof selector.organizationId !== "string"
    || !UUID.test(selector.organizationId)
    || typeof selector.sourceId !== "string" || !UUID.test(selector.sourceId)
    || typeof selector.sourceSha256 !== "string" || !SHA.test(selector.sourceSha256)
    || typeof selector.candidatesSha256 !== "string"
    || !SHA.test(selector.candidatesSha256)
    || typeof selector.reviewedSelectionSha256 !== "string"
    || !SHA.test(selector.reviewedSelectionSha256)) {
    throw new TypeError("Invalid private scope reconciliation selector");
  }
}

function parseObservation(value: unknown): {
  state: ScopeState; persistedRevision: 2 | 3;
  observedSelectionSha256: string | null;
} {
  if (!exactObject(value, ["observation","persisted_revision",
    "observed_selection_sha256"])) {
    throw new Error("Private scope inspection returned an invalid result");
  }
  const state = value.observation;
  const revision = value.persisted_revision;
  const hash = value.observed_selection_sha256;
  if (state === "unreviewed-at-read" && revision === 2 && hash === null) {
    return {state,persistedRevision:2,observedSelectionSha256:null};
  }
  if ((state === "matching-scope-at-read"
    || state === "different-scope-at-read"
    || state === "matching-stale-policy-at-read")
    && revision === 3 && typeof hash === "string" && SHA.test(hash)) {
    return {state,persistedRevision:3,observedSelectionSha256:hash};
  }
  throw new Error("Private scope inspection evidence is malformed");
}

/**
 * Staged server-side read-only adapter: the caller MUST provide a genuine
 * active-session verifier and privileged PRIMARY database port. Neither port
 * is implemented here. Never use this from a browser or public RPC.
 */
export function createTrustedTypedNoteScopeRecovery(
  auth: ActiveSessionVerifier, database: PrivateIntakeDatabase,
) {
  async function verifiedActor(session: unknown): Promise<string> {
    const identity = await auth.verifyActiveSession(session);
    if (!exactObject(identity, ["userId"])
      || typeof identity.userId !== "string"
      || !UUID.test(identity.userId)) {
      throw new Error("Fresh verified scope reviewer identity required");
    }
    return identity.userId;
  }

  async function observe(
    input: ScopeSelector, originalActor?: string,
  ) {
    const actor = await verifiedActor(input.session);
    if (originalActor && actor !== originalActor) {
      throw new Error("Scope reviewer identity changed between inspections");
    }
    // No client-provided actor, Auth claims, pricing or write query.
    // SQL locks current membership and creator-owned source and independently
    // verifies the historical approved policy and both review fingerprints.
    const result = await database.query(INSPECT, [
      input.organizationId, actor, input.sourceId, input.sourceSha256,
      input.candidatesSha256, input.reviewedSelectionSha256,
    ]);
    if (!result || !Array.isArray(result.rows)
      || result.rows.length !== 1) {
      throw new Error("No unambiguous primary scope inspection result");
    }
    const evidence = parseObservation(result.rows[0]);
    if (evidence.state === "different-scope-at-read") {
      if (evidence.observedSelectionSha256 === input.reviewedSelectionSha256) {
        throw new Error("Private scope result contradicts requested selection");
      }
    } else if (evidence.state !== "unreviewed-at-read"
      && evidence.observedSelectionSha256 !== input.reviewedSelectionSha256) {
      throw new Error("Private scope result misrepresents expected selection");
    }
    return {actor, evidence};
  }

  return {
    /**
     * Require TWO separately reauthorized primary reads. If either fails,
     * fail closed. Even matching observations prove only what was persisted
     * when read, not which attempt wrote it or whether retrying is safe.
     */
    async reconcile(input: ScopeSelector): Promise<TrustedScopeReconciliation> {
      checkSelector(input);
      // The session remains opaque, but source identity and evidence proofs
      // cannot be retargeted by a caller during either asynchronous read.
      const target: ScopeSelector = {
        session:input.session,
        organizationId:input.organizationId, sourceId:input.sourceId,
        sourceSha256:input.sourceSha256,
        candidatesSha256:input.candidatesSha256,
        reviewedSelectionSha256:input.reviewedSelectionSha256,
      };
      const first = await observe(target);
      const second = await observe(target, first.actor);
      const base = {
        organizationId:target.organizationId, sourceId:target.sourceId,
      };
      if (first.evidence.state !== second.evidence.state
        || first.evidence.persistedRevision !== second.evidence.persistedRevision
        || first.evidence.observedSelectionSha256
          !== second.evidence.observedSelectionSha256) {
        return {...base,state:"changed-during-read"};
      }
      return {...base,...second.evidence};
    },
  };
}
