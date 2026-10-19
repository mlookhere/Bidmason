import { createHash } from "node:crypto";
import type { VersionedEconomicsPolicy } from "./company-economics.ts";
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

export type ReviewWorkbenchSelection = {
  key: string;
  selectedIndices: number[];
  acceptedAddonCodes: string[];
};

export type ReviewWorkbenchAction =
  | { type: "select"; index: number; checked: boolean }
  | { type: "acknowledge-addon"; serviceCode: string; checked: boolean }
  | { type: "reset" };

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
    } else if (entry.optionalAddon === true) {
      status = "optional";
      explanation = "Requires separate human acknowledgement before preview.";
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
    review.sourceSha256, review.candidatesSha256, policy,
  ])).digest("hex");
  return {
    state: "internal-review-only", key,
    sourceSha256: review.sourceSha256,
    policyRevision: policy.revision,
    policyId: policy.pricing.policyId,
    rows,
  };
}

export function emptyReviewSelection(key: string): ReviewWorkbenchSelection {
  return { key, selectedIndices: [], acceptedAddonCodes: [] };
}

export function changeReviewSelection(
  model: ReviewWorkbenchModel,
  current: ReviewWorkbenchSelection,
  action: ReviewWorkbenchAction,
): ReviewWorkbenchSelection {
  const prior = current?.key === model.key
    ? current : emptyReviewSelection(model.key);
  if (action.type === "reset") return emptyReviewSelection(model.key);
  if (action.type === "select") {
    const row = model.rows.find(x => x.index === action.index);
    if (!row || !["available", "optional"].includes(row.status)
      || typeof action.checked !== "boolean") {
      throw new Error("Service is not eligible for review selection");
    }
    const selected = new Set(prior.selectedIndices);
    if (action.checked) selected.add(row.index);
    else selected.delete(row.index);
    const accepted = prior.acceptedAddonCodes.filter(code =>
      model.rows.some(x => selected.has(x.index)
        && x.status === "optional" && x.serviceCode === code));
    return { key: model.key,
      selectedIndices: [...selected].sort((a, b) => a - b),
      acceptedAddonCodes: accepted };
  }
  if (action.type === "acknowledge-addon") {
    const row = model.rows.find(x => x.serviceCode === action.serviceCode
      && x.status === "optional" && prior.selectedIndices.includes(x.index));
    if (!row || typeof action.checked !== "boolean") {
      throw new Error("Unselected or unapproved optional service");
    }
    const accepted = new Set(prior.acceptedAddonCodes);
    if (action.checked) accepted.add(row.serviceCode);
    else accepted.delete(row.serviceCode);
    return { ...prior, acceptedAddonCodes: [...accepted].sort() };
  }
  throw new TypeError("Unsupported review selection action");
}

/** This payload is merely a preview request, never a send/approval decision.
 * The trusted server must revalidate original, policy, membership and review. */
export function prepareReviewPreviewRequest(
  model: ReviewWorkbenchModel, selection: ReviewWorkbenchSelection,
): { reviewKey: string; selectedIndices: number[];
  acceptedAddonCodes: string[] } {
  if (!selection || selection.key !== model.key
    || !Array.isArray(selection.selectedIndices)
    || selection.selectedIndices.length === 0
    || !Array.isArray(selection.acceptedAddonCodes)
    || new Set(selection.selectedIndices).size !== selection.selectedIndices.length
    || new Set(selection.acceptedAddonCodes).size !== selection.acceptedAddonCodes.length) {
    throw new Error("Review selection is stale or incomplete");
  }
  const selectedCodes = new Set<string>();
  for (const index of selection.selectedIndices) {
    const row = model.rows.find(x => x.index === index);
    if (!row || !["available", "optional"].includes(row.status)
      || selectedCodes.has(row.serviceCode)) {
      throw new Error("Duplicate or ineligible selected service");
    }
    selectedCodes.add(row.serviceCode);
    if (row.status === "optional"
      && !selection.acceptedAddonCodes.includes(row.serviceCode)) {
      throw new Error("Selected optional add-on requires acknowledgement");
    }
  }
  for (const code of selection.acceptedAddonCodes) {
    if (!model.rows.some(x => x.status === "optional"
      && x.serviceCode === code && selection.selectedIndices.includes(x.index))) {
      throw new Error("Unselected add-on cannot be acknowledged");
    }
  }
  return {
    reviewKey: model.key,
    selectedIndices: [...selection.selectedIndices],
    acceptedAddonCodes: [...selection.acceptedAddonCodes],
  };
}
