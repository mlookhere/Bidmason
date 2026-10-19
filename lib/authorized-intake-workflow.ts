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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

/** Inspect descriptors before using authority-bearing caller data. */
function exactDataFields(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}
function denseSelection(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > 50
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i=0;i<value.length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if (d?.enumerable !== true || !Object.hasOwn(d,"value")) return false;
  }
  return true;
}

/** Shared data-only request boundary for tenant and direct preview readers. */
export function snapshotInternalPreviewRequest(
  request: InternalPreviewRequest,
): InternalPreviewRequest {
  if (!exactDataFields(request,["reviewKey","selectedIndices","acceptedAddonCodes"])
    || typeof request.reviewKey !== "string" || !HASH.test(request.reviewKey)
    || !denseSelection(request.selectedIndices)
    || !denseSelection(request.acceptedAddonCodes)) {
    throw new TypeError("Invalid internal preview request");
  }
  return {reviewKey:request.reviewKey,
    selectedIndices:[...request.selectedIndices] as number[],
    acceptedAddonCodes:[...request.acceptedAddonCodes] as string[]};
}

/** Context is server-owned evidence, never supplied by a browser. Snapshot it
 * nonetheless so async Auth/policy adapters cannot observe moving inputs. */
function snapshotContext(input: SourceContext, preview=false): SourceContext {
  const fields=preview
    ? ["organizationId","original","review","request"]
    : ["organizationId","original","review"];
  if (!exactDataFields(input,fields)
    || typeof input.organizationId !== "string" || !UUID.test(input.organizationId)) {
    throw new TypeError("Invalid internal review source context");
  }
  try {
    return {organizationId:input.organizationId,
      original:structuredClone(input.original),
      review:structuredClone(input.review)};
  }catch{
    throw new TypeError("Invalid internal review source context");
  }
}

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
  const target = snapshotContext(context);
  const first = fromApprovedHistory(await store.readAuthorized({
    organizationId: target.organizationId, session,
  }), target);
  const last = fromApprovedHistory(await store.readAuthorized({
    organizationId: target.organizationId, session,
  }), target);
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
  const target = snapshotContext(input,true);
  const request = snapshotInternalPreviewRequest(input.request);
  const history = await store.readAuthorized({
    organizationId: target.organizationId, session,
  });
  const model = fromApprovedHistory(history, target);
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
  const active = readActivePolicy(history!, target.organizationId);
  const preview = previewReviewedEconomics(
    target.original, target.review, validated.selectedIndices,
    active, validated.acceptedAddonCodes,
  );
  const latest = fromApprovedHistory(await store.readAuthorized({
    organizationId: target.organizationId, session,
  }), target);
  if (latest.key !== model.key) {
    throw new Error("Company review changed during preview; refresh required");
  }
  return preview;
}
