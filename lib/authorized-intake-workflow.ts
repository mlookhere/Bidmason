import { readActivePolicy, type PolicyHistory } from "./company-policy-revisions.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import type { ExtractionReview, IntakeSource } from "./intake-review.ts";
import { previewReviewedEconomics, type ReviewedEconomicsPreview }
  from "./intake-quote-preview.ts";
import { buildReviewWorkbench, type ReviewWorkbenchModel }
  from "./intake-review-workbench.ts";
import { prepareReviewPreviewRequest } from "./intake-review-selection.ts";

export type InternalPreviewRequest = {
  reviewKey: string;
  selectedIndices: number[];
  acceptedAddonCodes: string[];
};

type SourceContext = {
  organizationId: string;
  original: IntakeSource;
  review: ExtractionReview;
};

/** This does not authenticate the caller; the trusted storage adapter MUST. */
function fromApprovedHistory(
  history: PolicyHistory | null,
  context: SourceContext,
): ReviewWorkbenchModel {
  if (!history) throw new Error("No approved company pricing is available");
  const active = readActivePolicy(history, context.organizationId);
  return buildReviewWorkbench(context.original, context.review, active);
}

/** Internal-only model loader. Both reads must freshly authorize membership. */
export async function readAuthorizedReviewWorkbench(
  store: TrustedPolicyStore,
  session: unknown,
  context: SourceContext,
): Promise<ReviewWorkbenchModel> {
  const first = fromApprovedHistory(await store.readAuthorized({
    organizationId: context.organizationId, session,
  }), context);
  const last = fromApprovedHistory(await store.readAuthorized({
    organizationId: context.organizationId, session,
  }), context);
  if (first.key !== last.key) {
    throw new Error("Company review changed during load; refresh required");
  }
  return last;
}

/**
 * Verifies a browser selection against the currently authorized, approved
 * tenant policy. Neither the workbench checksum nor this request can approve,
 * publish, send or store a customer-facing proposal.
 */
export async function previewAuthorizedWorkbenchSelection(
  store: TrustedPolicyStore,
  session: unknown,
  input: SourceContext & { request: InternalPreviewRequest },
): Promise<ReviewedEconomicsPreview> {
  const request = input?.request;
  if (!request || typeof request !== "object" || Array.isArray(request)
    || Object.keys(request).some(key => ![
      "reviewKey", "selectedIndices", "acceptedAddonCodes",
    ].includes(key))
    || typeof request.reviewKey !== "string"
    || !/^[0-9a-f]{64}$/.test(request.reviewKey)) {
    throw new TypeError("Invalid internal preview request");
  }
  const history = await store.readAuthorized({
    organizationId: input.organizationId, session,
  });
  const model = fromApprovedHistory(history, input);
  if (request.reviewKey !== model.key) {
    throw new Error("Review key is stale; reload the approved company policy");
  }
  // The client-provided selected lines and optional acknowledgements are
  // always rechecked against server-created evidence and policy status.
  const validated = prepareReviewPreviewRequest(model, {
    key: request.reviewKey,
    selectedIndices: request.selectedIndices,
    acceptedAddonCodes: request.acceptedAddonCodes,
  });
  const active = readActivePolicy(history!, input.organizationId);
  const preview = previewReviewedEconomics(
    input.original, input.review, validated.selectedIndices,
    active, validated.acceptedAddonCodes,
  );
  const latest = fromApprovedHistory(await store.readAuthorized({
    organizationId: input.organizationId, session,
  }), input);
  if (latest.key !== model.key) {
    throw new Error("Company review changed during preview; refresh required");
  }
  return preview;
}
