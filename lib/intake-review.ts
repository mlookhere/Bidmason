import { createHash } from "node:crypto";
import { quoteFromPolicy, type CompanyPricePolicy, type QuoteResult } from "./company-pricing.ts";

/**
 * Offline intake review boundary. An extractor may suggest candidates but
 * cannot turn them into approved pricing or evidence by itself.
 * Authentication and source persistence belong to the trusted backend.
 */
export type IntakeSource = {
  kind: "typed-note" | "transcript";
  text: string;
  transcriptionSucceeded?: boolean;
};

export type ServiceCandidate = {
  serviceCode: string;
  units: number;
  start: number;
  end: number;
  excerpt: string;
};

export type ExtractionReview = {
  state: "needs-human-review";
  kind: IntakeSource["kind"];
  sourceSha256: string;
  candidatesSha256: string;
  candidates: ServiceCandidate[];
};

const CODE = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_BYTES = 64 * 1024;
const MAX_CANDIDATES = 50;

function validateSource(source: IntakeSource): void {
  if (!source || !["typed-note", "transcript"].includes(source.kind)
    || typeof source.text !== "string"
    || source.text.trim().length === 0
    || Buffer.byteLength(source.text, "utf8") > MAX_BYTES) {
    throw new TypeError("Valid bounded original intake text is required");
  }
  if (source.kind === "transcript" && source.transcriptionSucceeded !== true) {
    throw new Error("Failed or unverified transcription cannot be extracted");
  }
}

function validateCandidates(source: IntakeSource, candidates: ServiceCandidate[]): void {
  if (!Array.isArray(candidates) || candidates.length === 0
    || candidates.length > MAX_CANDIDATES) {
    throw new TypeError("One to 50 extraction candidates are required");
  }
  for (const c of candidates) {
    if (!c || typeof c.serviceCode !== "string" || !CODE.test(c.serviceCode)
      || !Number.isSafeInteger(c.units) || c.units < 1
      || !Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end)
      || c.start < 0 || c.end <= c.start || c.end > source.text.length
      || typeof c.excerpt !== "string"
      || c.excerpt.trim().length === 0
      || source.text.slice(c.start, c.end) !== c.excerpt) {
      throw new TypeError("Candidate lacks exact-source provenance or valid units");
    }
  }
}

function digest(source: IntakeSource): string {
  return createHash("sha256").update(source.kind + "\0" + source.text).digest("hex");
}

/** Detect accidental or unauthorized changes to a stored review snapshot.
 * This is a consistency checksum, NOT a server signature or authorization.
 */
function candidatesDigest(candidates: ServiceCandidate[]): string {
  return createHash("sha256").update(JSON.stringify(candidates.map(c => [
    c.serviceCode, c.units, c.start, c.end, c.excerpt,
  ]))).digest("hex");
}

/** Records untrusted model suggestions with character-exact source references. */
export function prepareExtractionReview(
  source: IntakeSource, candidates: ServiceCandidate[],
): ExtractionReview {
  validateSource(source);
  validateCandidates(source, candidates);
  const snapshot = candidates.map(c => ({ ...c }));
  return {
    state: "needs-human-review",
    kind: source.kind,
    sourceSha256: digest(source),
    candidatesSha256: candidatesDigest(snapshot),
    candidates: snapshot,
  };
}

export type ReviewedQuotePreview = {
  state: "preview-only";
  sourceSha256: string;
  quote: QuoteResult;
};

/**
 * Builds a NON-SENDABLE quote preview from explicitly selected candidates.
 * The calling authenticated review workflow must independently authorize the
 * reviewer and commit an immutable approval before publication.
 */
export function previewReviewedQuote(
  original: IntakeSource,
  review: ExtractionReview,
  selectedIndices: number[],
  policy: CompanyPricePolicy,
): ReviewedQuotePreview {
  validateSource(original);
  if (!review || review.state !== "needs-human-review"
    || review.kind !== original.kind || review.sourceSha256 !== digest(original)) {
    throw new Error("Intake review does not match the immutable original");
  }
  validateCandidates(original, review.candidates);
  if (review.candidatesSha256 !== candidatesDigest(review.candidates)) {
    throw new Error("Reviewed candidate snapshot was modified");
  }
  if (!Array.isArray(selectedIndices) || selectedIndices.length === 0
    || selectedIndices.length > review.candidates.length) {
    throw new TypeError("Explicit reviewed candidate selections are required");
  }
  const seen = new Set<number>();
  const requested = selectedIndices.map(index => {
    if (!Number.isSafeInteger(index) || index < 0
      || index >= review.candidates.length || seen.has(index)) {
      throw new TypeError("Invalid or duplicated review selection");
    }
    seen.add(index);
    const selected = review.candidates[index];
    return { serviceCode: selected.serviceCode, units: selected.units };
  });
  return {
    state: "preview-only",
    sourceSha256: review.sourceSha256,
    quote: quoteFromPolicy(policy, requested),
  };
}
