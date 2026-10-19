import { createHash } from "node:crypto";
import type { IntakeSource } from "./intake-review.ts";
import type { TranscriptionOutcome, Uncertainty } from "./audio-transcription.ts";

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_REPLACEMENT = 512;
const MAX_REASON = 500;
const HASH = /^[0-9a-f]{64}$/;

export type TranscriptClarification = {
  uncertaintyIndex: number;
  replacement: string;
  explanation: string;
};

export type TranscriptClarificationQuestion = {
  uncertaintyIndex: number;
  reason: Uncertainty["reason"];
  originalExcerpt: string;
  start: number;
  end: number;
};

export type TranscriptCorrectionRecord = {
  uncertaintyIndex: number;
  originalExcerpt: string;
  originalStart: number;
  originalEnd: number;
  correctedStart: number;
  correctedEnd: number;
  replacement: string;
  explanation: string;
};

export type TranscriptCorrectionDraft = {
  state: "awaiting-authorized-correction";
  audioSha256: string;
  rawTranscriptSha256: string;
  proposedTranscriptSha256: string;
  correctionSha256: string;
  providerName: string;
  providerVersion: string;
  corrections: TranscriptCorrectionRecord[];
  /** Intentionally NOT eligible for extraction before authenticated commit. */
  proposedSource: IntakeSource;
};

/** Only inert exact data reaches the correction/audit fingerprint. */
function exactData(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => {
    if (typeof key !== "string" || !fields.includes(key)) return false;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property?.enumerable === true && Object.hasOwn(property, "value");
  });
}
function denseDataArray(value: unknown, min: number, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < min || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, String(i));
    if (item?.enumerable !== true || !Object.hasOwn(item, "value")) return false;
  }
  return true;
}

function requireBlocked(outcome: TranscriptionOutcome): asserts outcome is
  Extract<TranscriptionOutcome, {state: "needs-information" | "needs-human-review"}> {
  if (!exactData(outcome, ["state", "audioSha256", "providerName",
      "providerVersion", "original", "durationMs", "uncertainties", "segments"])
    || outcome.state !== "needs-information"
    || !exactData(outcome.original, ["kind", "text", "transcriptionSucceeded"])
    || outcome.original.kind !== "transcript"
    || outcome.original.transcriptionSucceeded !== false
    || typeof outcome.original.text !== "string" || !outcome.original.text.trim()
    || Buffer.byteLength(outcome.original.text, "utf8") > MAX_TEXT_BYTES
    || typeof outcome.audioSha256 !== "string" || !HASH.test(outcome.audioSha256)
    || typeof outcome.providerName !== "string" || !outcome.providerName.trim()
    || typeof outcome.providerVersion !== "string" || !outcome.providerVersion.trim()
    || !denseDataArray(outcome.uncertainties, 1, 50)) {
    throw new Error("Only a bounded unresolved transcript can be clarified");
  }
}

function checkedUncertainties(outcome: TranscriptionOutcome): {
  index: number; uncertainty: Uncertainty
}[] {
  requireBlocked(outcome);
  const text = outcome.original.text;
  const sorted = outcome.uncertainties.map((uncertainty, index) => {
    if (!exactData(uncertainty, ["start", "end", "excerpt", "reason"])) {
      throw new Error("Uncertainty span is invalid or overlapping");
    }
    // Make an inert copy before sorting or building review/audit records.
    return {index, uncertainty: {
      start: uncertainty.start, end: uncertainty.end,
      excerpt: uncertainty.excerpt, reason: uncertainty.reason,
    }};
  }).sort((a, b) => a.uncertainty.start - b.uncertainty.start);
  let previousEnd = 0;
  for (const {uncertainty: u} of sorted) {
    if (!u || !Number.isSafeInteger(u.start) || !Number.isSafeInteger(u.end)
      || u.start < previousEnd || u.end <= u.start || u.end > text.length
      || typeof u.excerpt !== "string"
      || text.slice(u.start, u.end) !== u.excerpt
      || !["ambiguous-number", "unclear-speech", "other"].includes(u.reason)) {
      throw new Error("Uncertainty span is invalid or overlapping");
    }
    previousEnd = u.end;
  }
  return sorted;
}

/** Describe every unresolved excerpt without inventing the speaker's words. */
export function listTranscriptClarifications(
  outcome: TranscriptionOutcome,
): TranscriptClarificationQuestion[] {
  return checkedUncertainties(outcome).map(({index, uncertainty: u}) => ({
    uncertaintyIndex: index, reason: u.reason,
    originalExcerpt: u.excerpt, start: u.start, end: u.end,
  }));
}

/**
 * Pure proposed correction ONLY. No caller can mark it provider-verified or
 * extraction-ready; a trusted persistence service must authenticate reviewer,
 * check the source revision and store the exact correction before activation.
 */
export function prepareTranscriptCorrectionDraft(
  outcome: TranscriptionOutcome,
  decisions: TranscriptClarification[],
): TranscriptCorrectionDraft {
  // The span helper validates input at runtime, but cannot narrow the
  // discriminated outcome type in this caller. Repeat the explicit assertion.
  requireBlocked(outcome);
  const spans = checkedUncertainties(outcome);
  if (!denseDataArray(decisions, spans.length, spans.length)) {
    throw new Error("Every ambiguous transcript span needs an explicit correction");
  }
  const byIndex = new Map<number, TranscriptClarification>();
  for (const c of decisions) {
    if (!exactData(c, ["uncertaintyIndex", "replacement", "explanation"])
      || !Number.isSafeInteger(c.uncertaintyIndex)
      || byIndex.has(c.uncertaintyIndex)
      || typeof c.replacement !== "string" || !c.replacement.trim()
      || c.replacement.length > MAX_REPLACEMENT
      || Buffer.byteLength(c.replacement, "utf8") > MAX_REPLACEMENT
      || /[\u0000-\u0008\u000b\u000e-\u001f]/.test(c.replacement)
      || typeof c.explanation !== "string" || !c.explanation.trim()
      || c.explanation.length > MAX_REASON) {
      throw new Error("Invalid or duplicate transcript correction");
    }
    byIndex.set(c.uncertaintyIndex, {
      uncertaintyIndex: c.uncertaintyIndex,
      replacement: c.replacement, explanation: c.explanation.trim(),
    });
  }
  const raw = outcome.original.text;
  const parts: string[] = [];
  const corrections: TranscriptCorrectionRecord[] = [];
  let previousEnd = 0, revisedEnd = 0;
  for (const {index, uncertainty: u} of spans) {
    const correction = byIndex.get(index);
    if (!correction) throw new Error("Missing transcript clarification");
    const prefix = raw.slice(previousEnd, u.start);
    parts.push(prefix);
    revisedEnd += prefix.length;
    const correctedStart = revisedEnd;
    parts.push(correction.replacement);
    revisedEnd += correction.replacement.length;
    corrections.push({
      uncertaintyIndex: index,
      originalExcerpt: u.excerpt,
      originalStart: u.start, originalEnd: u.end,
      correctedStart, correctedEnd: revisedEnd,
      replacement: correction.replacement,
      explanation: correction.explanation.trim(),
    });
    previousEnd = u.end;
  }
  parts.push(raw.slice(previousEnd));
  const proposed = parts.join("");
  if (!proposed.trim() || Buffer.byteLength(proposed, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("Corrected transcript is empty or unbounded");
  }
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const rawTranscriptSha256 = sha(raw);
  const proposedTranscriptSha256 = sha(proposed);
  const correctionSha256 = sha(JSON.stringify([
    outcome.audioSha256, rawTranscriptSha256,
    outcome.providerName, outcome.providerVersion, corrections,
    proposedTranscriptSha256,
  ]));
  return {
    state: "awaiting-authorized-correction",
    audioSha256: outcome.audioSha256,
    rawTranscriptSha256, proposedTranscriptSha256, correctionSha256,
    providerName: outcome.providerName, providerVersion: outcome.providerVersion,
    corrections,
    proposedSource: {
      kind: "transcript", text: proposed, transcriptionSucceeded: false,
    },
  };
}
