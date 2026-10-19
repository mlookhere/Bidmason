import { createHash } from "node:crypto";
import type { ExtractionReview, IntakeSource } from "./intake-review.ts";
import type { TrustedPolicyStore } from "./company-policy-service.ts";
import { readAuthorizedReviewWorkbench, previewAuthorizedWorkbenchSelection,
  type InternalPreviewRequest } from "./authorized-intake-workflow.ts";
import type { ReviewWorkbenchModel } from "./intake-review-workbench.ts";
import type { ReviewedEconomicsPreview } from "./intake-quote-preview.ts";

/** The current, server-owned source and extraction snapshot. */
export type AuthorizedIntakeRecord = {
  organizationId: string;
  sourceId: string;
  revision: number;
  original: IntakeSource;
  review: ExtractionReview;
};

/** Must validate session, organization membership and source ownership on
 * EVERY call against trusted persistence. Never implement with client state. */
export interface TrustedIntakeStore {
  readAuthorized(input: {
    session: unknown;
    organizationId: string;
    sourceId: string;
  }): Promise<AuthorizedIntakeRecord | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type SourceSelector = { organizationId: string; sourceId: string };

function validateSelector(selector: SourceSelector): void {
  if (!selector || typeof selector !== "object" || !UUID.test(selector.organizationId)
    || !UUID.test(selector.sourceId)) {
    throw new TypeError("Invalid tenant intake record selector");
  }
}

function checkedRecord(record: AuthorizedIntakeRecord | null,
  selector: SourceSelector): {record: AuthorizedIntakeRecord; stamp: string} {
  if (!record || record.organizationId !== selector.organizationId
    || record.sourceId !== selector.sourceId
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || !record.original || !record.review
    || typeof record.original.text !== "string"
    || Buffer.byteLength(record.original.text, "utf8") > 65536
    || !Array.isArray(record.review.candidates)
    || record.review.candidates.length > 50) {
    throw new Error("Tenant-owned intake record missing or inconsistent");
  }
  // Consistency stamp detects source/extraction mutation even when a buggy
  // adapter fails to increment revision. NOT authorization or approval.
  const stamp = createHash("sha256").update(JSON.stringify([
    record.organizationId, record.sourceId, record.revision,
    record.original, record.review,
  ])).digest("hex");
  return {record, stamp};
}

async function load(sourceStore: TrustedIntakeStore, session: unknown,
  selector: SourceSelector) {
  validateSelector(selector);
  return checkedRecord(await sourceStore.readAuthorized({
    session, organizationId: selector.organizationId, sourceId: selector.sourceId,
  }), selector);
}

/** Internal source-ID lookup. Browser never supplies text, extraction, policy,
 * actor identity, approvals or price amounts. */
export async function readTenantIntakeWorkbench(
  sourceStore: TrustedIntakeStore,
  policyStore: TrustedPolicyStore,
  session: unknown,
  selector: SourceSelector,
): Promise<ReviewWorkbenchModel> {
  const first = await load(sourceStore, session, selector);
  const model = await readAuthorizedReviewWorkbench(policyStore, session, {
    organizationId: selector.organizationId,
    original: first.record.original,
    review: first.record.review,
  });
  const latest = await load(sourceStore, session, selector);
  if (latest.stamp !== first.stamp) {
    throw new Error("Tenant intake evidence changed during review; refresh required");
  }
  return model;
}

/** Internal preview-only computation with independent authorized evidence and
 * policy reads. Actual proposal sends require separate atomic checks. */
export async function previewTenantIntakeSelection(
  sourceStore: TrustedIntakeStore,
  policyStore: TrustedPolicyStore,
  session: unknown,
  input: SourceSelector & { request: InternalPreviewRequest },
): Promise<ReviewedEconomicsPreview> {
  const first = await load(sourceStore, session, input);
  const result = await previewAuthorizedWorkbenchSelection(policyStore, session, {
    organizationId: input.organizationId,
    original: first.record.original,
    review: first.record.review,
    request: input.request,
  });
  const latest = await load(sourceStore, session, input);
  if (latest.stamp !== first.stamp) {
    throw new Error("Tenant intake evidence changed during preview; refresh required");
  }
  return result;
}
