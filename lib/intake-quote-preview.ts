import { createHash } from "node:crypto";
import { canonicalCompanyPolicyText } from "./company-policy-fingerprint.ts";
import { previewCompanyEconomics, type VersionedEconomicsPolicy,
  type EconomicsPreview } from "./company-economics.ts";
import { selectReviewedServices, type ExtractionReview,
  type IntakeSource } from "./intake-review.ts";

export type ReviewedEconomicsPreview = {
  state: "preview-only";
  sourceSha256: string;
  candidatesSha256: string;
  reviewedSelectionSha256: string;
  selectedServices: { serviceCode: string; units: number; start: number; end: number;
    addonAccepted?: true }[];
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
  acceptedAddonCodes: readonly string[] = [],
): ReviewedEconomicsPreview {
  const services = selectReviewedServices(original, review, selection);
  // Both add-on acknowledgements and the ratecard are caller-provided data
  // in the standalone helper. Inspect descriptors before reading any element
  // or optional service flag; never invoke a forged getter as human consent.
  if (!Array.isArray(acceptedAddonCodes)
    || Object.getPrototypeOf(acceptedAddonCodes) !== Array.prototype
    || acceptedAddonCodes.length > 50
    || Reflect.ownKeys(acceptedAddonCodes).length !== acceptedAddonCodes.length + 1) {
    throw new Error("Invalid or unselected optional add-on acceptance");
  }
  const addons: string[] = [];
  for (let i = 0; i < acceptedAddonCodes.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(
      acceptedAddonCodes, String(i));
    if (descriptor?.enumerable !== true
      || !Object.hasOwn(descriptor, "value")
      || typeof descriptor.value !== "string") {
      throw new Error("Invalid or unselected optional add-on acceptance");
    }
    addons.push(descriptor.value);
  }
  const policySnapshot = JSON.parse(canonicalCompanyPolicyText(policy))
    as VersionedEconomicsPolicy;
  if (addons.some((code, i) => !/^[a-z][a-z0-9_-]{0,63}$/.test(code)
      || (i > 0 && code <= addons[i - 1])
      || !services.some(s => s.serviceCode === code)
      || policySnapshot.pricing?.services?.[code]?.optionalAddon !== true)) {
    throw new Error("Invalid or unselected optional add-on acceptance");
  }
  const accepted = new Set(addons);
  const reviewedInputs = services.map(s => ({
    ...s, ...(accepted.has(s.serviceCode) ? { addonAccepted: true as const } : {}),
  }));
  const economics = previewCompanyEconomics(policySnapshot, reviewedInputs);
  const selectedServices = selection.map((index, i) => ({
    serviceCode: services[i].serviceCode,
    units: services[i].units,
    start: review.candidates[index].start,
    end: review.candidates[index].end,
    ...(accepted.has(services[i].serviceCode) ? { addonAccepted: true as const } : {}),
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
