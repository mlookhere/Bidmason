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

function requireBlocked(outcome: TranscriptionOutcome): asserts outcome is
  Extract<TranscriptionOutcome, {state: "needs-information" | "needs-human-review"}> {
  if (!outcome || outcome.state !== "needs-information"
    || outcome.original?.kind !== "transcript"
    || outcome.original.transcriptionSucceeded !== false
    || typeof outcome.original.text !== "string" || !outcome.original.text.trim()
    || Buffer.byteLength(outcome.original.text, "utf8") > MAX_TEXT_BYTES
    || typeof outcome.audioSha256 !== "string" || !HASH.test(outcome.audioSha256)
    || !outcome.providerName?.trim() || !outcome.providerVersion?.trim()
    || !Array.isArray(outcome.uncertainties)
    || outcome.uncertainties.length === 0 || outcome.uncertainties.length > 50) {
    throw new Error("Only a bounded unresolved transcript can be clarified");
  }
}

function checkedUncertainties(outcome: TranscriptionOutcome): {
  index: number; uncertainty: Uncertainty
}[] {
  requireBlocked(outcome);
  const text = outcome.original.text;
  const sorted = outcome.uncertainties.map((uncertainty, index) =>
    ({index, uncertainty})).sort((a, b) =>
      a.uncertainty.start - b.uncertainty.start);
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
  if (!Array.isArray(decisions) || decisions.length !== spans.length) {
    throw new Error("Every ambiguous transcript span needs an explicit correction");
  }
  const byIndex = new Map<number, TranscriptClarification>();
  for (const c of decisions) {
    if (!c || typeof c !== "object" || Array.isArray(c)
      || Object.keys(c).length !== 3
      || !["uncertaintyIndex", "replacement", "explanation"]
        .every(k => Object.hasOwn(c, k))
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
    byIndex.set(c.uncertaintyIndex, c);
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
