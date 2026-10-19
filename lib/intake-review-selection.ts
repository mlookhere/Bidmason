import type { ReviewWorkbenchModel } from "./intake-review-workbench.ts";

export type ReviewWorkbenchSelection = {
  key: string;
  selectedIndices: number[];
  acceptedAddonCodes: string[];
};

export type ReviewWorkbenchAction =
  | { type: "select"; index: number; checked: boolean }
  | { type: "acknowledge-addon"; serviceCode: string; checked: boolean }
  | { type: "reset" };

/** Reject untrusted selection directives without evaluating any getters. */
function exactSelection(value: unknown): value is ReviewWorkbenchSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = ["key", "selectedIndices", "acceptedAddonCodes"];
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true
      && Object.hasOwn(descriptor, "value");
  });
}
function canonicalSelectionArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length > 50
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true
      || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
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
  if (!exactSelection(selection) || selection.key !== model.key
    || !canonicalSelectionArray(selection.selectedIndices)
    || selection.selectedIndices.length === 0
    || selection.selectedIndices.some((index, i) => !Number.isSafeInteger(index)
      || index < 0 || (i > 0 && index <= selection.selectedIndices[i - 1]))
    || !canonicalSelectionArray(selection.acceptedAddonCodes)
    || selection.acceptedAddonCodes.some((code, i) => typeof code !== "string"
      || !/^[a-z][a-z0-9_-]{0,63}$/.test(code)
      || (i > 0 && code <= selection.acceptedAddonCodes[i - 1]))) {
    throw new Error("Review selection is stale or incomplete (noncanonical selection)");
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
