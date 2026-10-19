import { readActivePolicy, reviewPolicyDraft, submitPolicyDraft,
  type PolicyHistory } from "./company-policy-revisions.ts";
import { previewReviewedEconomics, type ReviewedEconomicsPreview }
  from "./intake-quote-preview.ts";
import type { VersionedEconomicsPolicy } from "./company-economics.ts";
import type { ExtractionReview, IntakeSource } from "./intake-review.ts";

type Head = { expectedRevision: number; expectedSha256: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;

/** Only own enumerable value descriptors can influence authorization or
 * company pricing. Never evaluate getters or trust prototype attributes. */
function requiredFields(value: unknown, fields: readonly string[], exact: boolean): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || (exact && Reflect.ownKeys(value).length !== fields.length)) return false;
  return fields.every(key => {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    return desc?.enumerable === true && Object.hasOwn(desc, "value");
  });
}

function snapshotPlain<T>(value: T, budget: {remaining: number} = {remaining: 20000},
  depth = 0): T {
  if (--budget.remaining < 0 || depth > 32) {
    throw new TypeError("Invalid policy request data");
  }
  if (value == null || typeof value === "string" || typeof value === "number"
    || typeof value === "boolean" || typeof value === "undefined") return value;
  if (typeof value !== "object") throw new TypeError("Invalid policy request data");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError("Invalid policy request data");
    }
    const output: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const field = Object.getOwnPropertyDescriptor(value, String(i));
      if (field?.enumerable !== true || !Object.hasOwn(field, "value")) {
        throw new TypeError("Invalid policy request data");
      }
      output.push(snapshotPlain(field.value, budget, depth + 1));
    }
    return output as T;
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError("Invalid policy request data");
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("Invalid policy request data");
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field?.enumerable !== true || !Object.hasOwn(field, "value")) {
      throw new TypeError("Invalid policy request data");
    }
    output[key] = snapshotPlain(field.value, budget, depth + 1);
  }
  return output as T;
}
function checkHead(input: Head & {organizationId: string}, fields: string[]): void {
  if (!requiredFields(input, fields, true)
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.expectedSha256 !== null
      && (typeof input.expectedSha256 !== "string" || !SHA.test(input.expectedSha256)))) {
    throw new TypeError("Invalid company policy request");
  }
}


/**
 * Implement on a trusted server, NEVER with a client-side Map or user-provided
 * actor ID. The persistence adapter MUST enforce current membership, role,
 * tenant scope and atomic expected-head compare-and-swap at commit time.
 * A revoked member must not be able to write after the permission check.
 */
export interface TrustedPolicyStore {
  mutateAuthorized(input: {
    organizationId: string;
    session: unknown;
    permission: "draft" | "review";
    transform: (current: PolicyHistory | null, authenticatedActorId: string) => PolicyHistory;
  }): Promise<PolicyHistory>;
  /** Every read must freshly authorize membership and tenant visibility. */
  readAuthorized(input: {
    organizationId: string;
    session: unknown;
  }): Promise<PolicyHistory | null>;
}

export function submitCompanyPolicyDraft(
  store: TrustedPolicyStore,
  session: unknown,
  input: { organizationId: string; policy: VersionedEconomicsPolicy } & Head,
): Promise<PolicyHistory> {
  checkHead(input, ["organizationId", "policy", "expectedRevision", "expectedSha256"]);
  const target = {organizationId: input.organizationId,
    policy: snapshotPlain(input.policy), expectedRevision: input.expectedRevision,
    expectedSha256: input.expectedSha256};
  return store.mutateAuthorized({
    organizationId: target.organizationId, session, permission: "draft",
    transform: (current, authenticatedActorId) => submitPolicyDraft(current, {
      organizationId: target.organizationId, submittedBy: authenticatedActorId,
      policy: target.policy, expectedRevision: target.expectedRevision,
      expectedSha256: target.expectedSha256,
    }),
  });
}

export function reviewCompanyPolicyDraft(
  store: TrustedPolicyStore,
  session: unknown,
  input: { organizationId: string; decision: "approve" | "reject" } & Head,
): Promise<PolicyHistory> {
  checkHead(input, ["organizationId", "decision", "expectedRevision", "expectedSha256"]);
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new TypeError("Invalid company policy request");
  }
  const target = {organizationId: input.organizationId, decision: input.decision,
    expectedRevision: input.expectedRevision, expectedSha256: input.expectedSha256};
  return store.mutateAuthorized({
    organizationId: target.organizationId, session, permission: "review",
    transform: (current, authenticatedActorId) => {
      if (!current) throw new Error("No company pricing draft to review");
      return reviewPolicyDraft(current, {
        organizationId: target.organizationId, reviewedBy: authenticatedActorId,
        decision: target.decision, expectedRevision: target.expectedRevision,
        expectedSha256: target.expectedSha256,
      });
    },
  });
}

function activeStamp(history: PolicyHistory, organizationId: string): string {
  // readActivePolicy validates *every* revision and the current active pointer.
  readActivePolicy(history, organizationId);
  const active = history.revisions.find(r => r.revision === history.activeRevision)!;
  return `${active.revision}:${active.policySha256}`;
}

/**
 * Internal, never-sendable preview. Two separately authorized reads prevent
 * reporting a result based on a policy that changed or an access grant that
 * was revoked during the calculation. Send/publish must reauthorize again.
 */
export async function previewAuthorizedReviewedEconomics(
  store: TrustedPolicyStore,
  session: unknown,
  input: { organizationId: string; original: IntakeSource;
    review: ExtractionReview; selection: number[];
    acceptedAddonCodes?: readonly string[] },
): Promise<ReviewedEconomicsPreview> {
  // Historical top-level pricing overrides are ignored, never treated as
  // source-of-truth. Require safe descriptors only for the accepted fields.
  const fields = ["organizationId", "original", "review", "selection"];
  if (!requiredFields(input, fields, false)
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)) {
    throw new TypeError("Invalid company pricing preview request");
  }
  const addon = Object.getOwnPropertyDescriptor(input, "acceptedAddonCodes");
  if (addon && (!addon.enumerable || !Object.hasOwn(addon, "value"))) {
    throw new TypeError("Invalid company pricing preview request");
  }
  const target = {
    organizationId: input.organizationId,
    original: snapshotPlain(input.original),
    review: snapshotPlain(input.review),
    selection: snapshotPlain(input.selection),
    acceptedAddonCodes: addon ? snapshotPlain(addon.value as readonly string[]) : [],
  };
  const first = await store.readAuthorized({
    organizationId: target.organizationId, session,
  });
  if (!first) throw new Error("No approved company pricing exists");
  const stamp = activeStamp(first, target.organizationId);
  const active = readActivePolicy(first, target.organizationId);
  const preview = previewReviewedEconomics(
    target.original, target.review, target.selection, active,
    target.acceptedAddonCodes,
  );
  const latest = await store.readAuthorized({
    organizationId: target.organizationId, session,
  });
  if (!latest || activeStamp(latest, target.organizationId) !== stamp) {
    throw new Error("Company policy changed during preview; refresh required");
  }
  return preview;
}
