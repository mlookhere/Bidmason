import { readActivePolicy, reviewPolicyDraft, submitPolicyDraft,
  type PolicyHistory } from "./company-policy-revisions.ts";
import { previewReviewedEconomics, type ReviewedEconomicsPreview }
  from "./intake-quote-preview.ts";
import type { VersionedEconomicsPolicy } from "./company-economics.ts";
import type { ExtractionReview, IntakeSource } from "./intake-review.ts";

type Head = { expectedRevision: number; expectedSha256: string | null };

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
  return store.mutateAuthorized({
    organizationId: input.organizationId, session, permission: "draft",
    transform: (current, authenticatedActorId) => submitPolicyDraft(current, {
      organizationId: input.organizationId, submittedBy: authenticatedActorId,
      policy: input.policy, expectedRevision: input.expectedRevision,
      expectedSha256: input.expectedSha256,
    }),
  });
}

export function reviewCompanyPolicyDraft(
  store: TrustedPolicyStore,
  session: unknown,
  input: { organizationId: string; decision: "approve" | "reject" } & Head,
): Promise<PolicyHistory> {
  return store.mutateAuthorized({
    organizationId: input.organizationId, session, permission: "review",
    transform: (current, authenticatedActorId) => {
      if (!current) throw new Error("No company pricing draft to review");
      return reviewPolicyDraft(current, {
        organizationId: input.organizationId, reviewedBy: authenticatedActorId,
        decision: input.decision, expectedRevision: input.expectedRevision,
        expectedSha256: input.expectedSha256,
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
  const first = await store.readAuthorized({
    organizationId: input.organizationId, session,
  });
  if (!first) throw new Error("No approved company pricing exists");
  const stamp = activeStamp(first, input.organizationId);
  const active = readActivePolicy(first, input.organizationId);
  const preview = previewReviewedEconomics(
    input.original, input.review, input.selection, active,
    input.acceptedAddonCodes ?? [],
  );
  const latest = await store.readAuthorized({
    organizationId: input.organizationId, session,
  });
  if (!latest || activeStamp(latest, input.organizationId) !== stamp) {
    throw new Error("Company policy changed during preview; refresh required");
  }
  return preview;
}
