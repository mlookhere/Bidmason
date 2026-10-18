import { createHash } from "node:crypto";
import { previewCompanyEconomics, type VersionedEconomicsPolicy,
  type EconomicsPreview } from "./company-economics.ts";
import { selectReviewedServices, type ExtractionReview,
  type IntakeSource } from "./intake-review.ts";

export type ReviewedEconomicsPreview = {
  state: "preview-only";
  sourceSha256: string;
  candidatesSha256: string;
  reviewedSelectionSha256: string;
  selectedServices: { serviceCode: string; units: number; start: number; end: number }[];
  economics: EconomicsPreview;
};

/**
 * Compose a reviewed exact-source selection with the company's versioned
 * deterministic economics. No client or model-supplied quote amounts are used.
 * This is NOT a signed approval, persisted review or customer-ready document.
 */
export function previewReviewedEconomics(
  original: IntakeSource,
  review: ExtractionReview,
  selection: number[],
  policy: VersionedEconomicsPolicy,
): ReviewedEconomicsPreview {
  const services = selectReviewedServices(original, review, selection);
  const economics = previewCompanyEconomics(policy, services);
  const selectedServices = selection.map((index, i) => ({
    serviceCode: services[i].serviceCode,
    units: services[i].units,
    start: review.candidates[index].start,
    end: review.candidates[index].end,
  }));
  const reviewedSelectionSha256 = createHash("sha256").update(JSON.stringify([
    review.sourceSha256, review.candidatesSha256,
    selectedServices, economics.policySha256,
  ])).digest("hex");
  return {
    state: "preview-only",
    sourceSha256: review.sourceSha256,
    candidatesSha256: review.candidatesSha256,
    reviewedSelectionSha256,
    selectedServices, economics,
  };
}
