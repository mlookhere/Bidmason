import { createHash } from "node:crypto";
import { previewCompanyEconomics, type VersionedEconomicsPolicy } from "./company-economics.ts";
import { companyPolicySha256 } from "./company-policy-fingerprint.ts";
import { selectReviewedServices, type ExtractionReview,
  type IntakeSource } from "./intake-review.ts";

export type ReviewRowStatus =
  "available" | "optional" | "pending" | "excluded" | "unlisted" | "invalid";

export type ReviewWorkbenchRow = {
  index: number;
  serviceCode: string;
  units: number;
  excerpt: string;
  label: string;
  status: ReviewRowStatus;
  explanation: string;
};

export type ReviewWorkbenchModel = {
  state: "internal-review-only";
  key: string;
  sourceSha256: string;
  policyRevision: number;
  policyId: string;
  rows: ReviewWorkbenchRow[];
};

export function buildReviewWorkbench(
  original: IntakeSource, review: ExtractionReview,
  policy: VersionedEconomicsPolicy,
): ReviewWorkbenchModel {
  if (!policy || !Number.isSafeInteger(policy.revision) || policy.revision < 1
    || typeof policy.pricing?.policyId !== "string"
    || !policy.pricing.policyId.trim()
    || !policy.pricing.services || typeof policy.pricing.services !== "object"
    || Array.isArray(policy.pricing.services)) {
    throw new TypeError("A valid company-owned pricing policy is required");
  }
  // Revalidate the original and every candidate, including candidates that
  // are not selectable. An invalid document fails as a whole.
  const candidates = selectReviewedServices(original, review,
    review.candidates.map((_, index) => index));
  const excluded = policy.excludedServiceCodes ?? [];
  if (!Array.isArray(excluded) || new Set(excluded).size !== excluded.length
    || excluded.some(code => typeof code !== "string"
      || !Object.hasOwn(policy.pricing.services, code))) {
    throw new TypeError("Company pricing exclusions are invalid");
  }
  const rows = candidates.map((candidate, index): ReviewWorkbenchRow => {
    const entry = policy.pricing.services[candidate.serviceCode];
    let status: ReviewRowStatus = "available";
    let explanation = "Available for human selection; no quote has been approved.";
    if (!Object.hasOwn(policy.pricing.services, candidate.serviceCode)) {
      status = "unlisted"; explanation = "Service is not in the company rate card.";
    } else if (!entry || typeof entry.label !== "string" || !entry.label.trim()
      || typeof entry.unit !== "string" || !entry.unit.trim()
      || !Number.isSafeInteger(entry.rateCents) || entry.rateCents < 0
      || (entry.optionalAddon !== undefined && typeof entry.optionalAddon !== "boolean")) {
      status = "invalid"; explanation = "Company service configuration is invalid.";
    } else if (excluded.includes(candidate.serviceCode)) {
      status = "excluded"; explanation = "Company policy excludes this service.";
    } else if (entry.billing === "pending") {
      status = "pending"; explanation = "Commercial terms are awaiting approval.";
    } else if (!["charged", "included"].includes(entry.billing)) {
      status = "invalid"; explanation = "Company billing configuration is invalid.";
    } else {
      // A service is not selectable merely because its label and base rate
      // look valid. Reuse the same policy/tax/cost engine as the actual preview,
      // so invalid math or incomplete declared costs block before selection.
      try {
        previewCompanyEconomics(policy, [{
          serviceCode: candidate.serviceCode, units: candidate.units,
          ...(entry.optionalAddon === true ? { addonAccepted: true as const } : {}),
        }]);
        if (entry.optionalAddon === true) {
          status = "optional";
          explanation = "Requires separate human acknowledgement before preview.";
        }
      } catch {
        status = "invalid";
        explanation = "Company pricing, tax, or cost inputs require correction before preview.";
      }
    }
    return {
      index, serviceCode: candidate.serviceCode,
      units: candidate.units, excerpt: review.candidates[index].excerpt,
      label: entry && typeof entry.label === "string"
        ? entry.label : candidate.serviceCode,
      status, explanation,
    };
  });
  // Consistency key only, not a tenant authorization or server signature.
  const key = createHash("sha256").update(JSON.stringify([
    review.sourceSha256, review.candidatesSha256, companyPolicySha256(policy),
  ])).digest("hex");
  return {
    state: "internal-review-only", key,
    sourceSha256: review.sourceSha256,
    policyRevision: policy.revision,
    policyId: policy.pricing.policyId,
    rows,
  };
}

export type { ReviewWorkbenchSelection, ReviewWorkbenchAction }
  from "./intake-review-selection.ts";
export { emptyReviewSelection, changeReviewSelection, prepareReviewPreviewRequest }
  from "./intake-review-selection.ts";
