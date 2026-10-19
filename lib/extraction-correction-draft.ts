import { createHash } from "node:crypto";
import { prepareExtractionReview, selectReviewedServices,
  type ExtractionReview, type IntakeSource, type ServiceCandidate }
  from "./intake-review.ts";

type Replace = { action: "replace"; index: number; candidate: ServiceCandidate; reason: string };
type Remove = { action: "remove"; index: number; reason: string };
type Add = { action: "add"; candidate: ServiceCandidate; reason: string };

export type ExtractionCorrectionChange = Replace | Remove | Add;

export type ExtractionCorrectionAudit = {
  action: "replace" | "remove" | "add";
  originalIndex?: number;
  before?: ServiceCandidate;
  after?: ServiceCandidate;
  reason: string;
};

export type ExtractionCorrectionDraft = {
  state: "awaiting-authorized-extraction-correction";
  sourceSha256: string;
  originalCandidatesSha256: string;
  proposedCandidatesSha256: string;
  correctionSha256: string;
  changes: ExtractionCorrectionAudit[];
  /** This is a proposed candidate list, NOT a committed ExtractionReview. */
  proposedCandidates: ServiceCandidate[];
};

function exactObject(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function exactList(value: unknown): value is ExtractionCorrectionChange[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1 || value.length > 100
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (d?.enumerable !== true || !Object.hasOwn(d, "value")) return false;
  }
  return true;
}

function explanation(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Human correction reason required");
  const reason = value.trim();
  if (!reason || reason.length > 500 || Buffer.byteLength(reason, "utf8") > 1000
    || /[\u0000-\u001f\u007f]/u.test(reason)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(reason)) {
    throw new TypeError("Valid bounded human correction reason required");
  }
  return reason;
}

function verifiedCandidate(source: IntakeSource, candidate: ServiceCandidate): ServiceCandidate {
  // Reuse the same exact-source span, code, quantity and closed data schema
  // as the untrusted extractor. Do not add a second competing validator.
  return prepareExtractionReview(source, [candidate]).candidates[0];
}

/**
 * An auditable proposed correction to the provider's immutable extraction.
 *
 * Does not mutate the provider review, persist an amendment, prove an actor's
 * identity, authorize a new candidate or turn scope into an approved quote.
 * A trusted tenant transaction must independently reread the source/review,
 * verify both SHA bindings, and durably record an authenticated correction
 * before using any proposed candidate for a later human scope decision.
 */
export function prepareExtractionCorrectionDraft(
  original: IntakeSource,
  review: ExtractionReview,
  changes: ExtractionCorrectionChange[],
): ExtractionCorrectionDraft {
  // Verify the complete original extraction, not just changed candidates.
  selectReviewedServices(original, review,
    review.candidates.map((_, index) => index));
  if (!exactList(changes)) {
    throw new TypeError("One to 100 canonical extraction corrections are required");
  }
  const indexed = new Map<number, ExtractionCorrectionAudit>();
  const additions: ExtractionCorrectionAudit[] = [];
  for (const change of changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new TypeError("Invalid extraction correction action");
    }
    const action = change.action;
    const schema = action === "replace"
      ? ["action", "index", "candidate", "reason"]
      : action === "remove"
      ? ["action", "index", "reason"]
      : action === "add"
      ? ["action", "candidate", "reason"] : [];
    if (!exactObject(change, schema) || schema.length === 0) {
      throw new TypeError("Invalid extraction correction action");
    }
    const reason = explanation(change.reason);
    if (action === "add") {
      additions.push({ action, after: verifiedCandidate(original, change.candidate), reason });
      continue;
    }
    if (!Number.isSafeInteger(change.index) || change.index < 0
      || change.index >= review.candidates.length || indexed.has(change.index)) {
      throw new TypeError("Unknown or duplicate extraction correction index");
    }
    const before = { ...review.candidates[change.index] };
    if (action === "remove") {
      indexed.set(change.index, { action, originalIndex: change.index, before, reason });
    } else {
      const after = verifiedCandidate(original, change.candidate);
      if (JSON.stringify(before) === JSON.stringify(after)) {
        throw new Error("A replacement must change the candidate");
      }
      indexed.set(change.index, {
        action, originalIndex: change.index, before, after, reason,
      });
    }
  }
  const proposedCandidates: ServiceCandidate[] = [];
  for (let index = 0; index < review.candidates.length; index++) {
    const edit = indexed.get(index);
    if (edit?.action === "remove") continue;
    proposedCandidates.push(edit?.after ?? { ...review.candidates[index] });
  }
  // User action ordering must not affect final scope or consistency digest.
  additions.sort((a, b) => {
    const x = a.after!, y = b.after!;
    return x.start - y.start || x.end - y.end
      || (x.serviceCode < y.serviceCode ? -1 : x.serviceCode > y.serviceCode ? 1 : 0);
  });
  proposedCandidates.push(...additions.map(edit => edit.after!));
  if (proposedCandidates.length === 0 || proposedCandidates.length > 50
    || new Set(proposedCandidates.map(c => c.serviceCode)).size !== proposedCandidates.length) {
    throw new Error("Corrected scope must contain one to 50 distinct services");
  }
  const proposedReview = prepareExtractionReview(original, proposedCandidates);
  if (proposedReview.candidatesSha256 === review.candidatesSha256) {
    throw new Error("Extraction correction must change the proposal");
  }
  const audits = [...[...indexed].sort(([a], [b]) => a - b).map(([, v]) => v), ...additions];
  const correctionSha256 = createHash("sha256").update(JSON.stringify([
    review.sourceSha256, review.candidatesSha256,
    proposedReview.candidatesSha256, audits,
  ])).digest("hex");
  return {
    state: "awaiting-authorized-extraction-correction",
    sourceSha256: review.sourceSha256,
    originalCandidatesSha256: review.candidatesSha256,
    proposedCandidatesSha256: proposedReview.candidatesSha256,
    correctionSha256,
    changes: audits,
    proposedCandidates: proposedReview.candidates,
  };
}
