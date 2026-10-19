import { createHash } from "node:crypto";
import { validateIntakeSource, type IntakeSource } from "./intake-review.ts";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_SEGMENTS = 200;
const MAX_UNCERTAINTIES = 50;

// Every substantive transcript character must belong to a timestamped segment.
// Only whitespace and punctuation may sit between segment excerpts.
const NON_SPEECH_GAP = /^[\p{White_Space}\p{P}]*$/u;

export type AudioFormat = "audio/wav" | "audio/mpeg" | "audio/mp4";
export type Uncertainty = {
  start: number; end: number; excerpt: string;
  reason: "unclear-speech" | "ambiguous-number" | "other";
};
export type TranscriptSegment = {
  start: number; end: number; excerpt: string;
  startMs: number; endMs: number;
};

export type TranscriptionProvider = {
  name: string;
  version: string;
  recognize(input: { audio: Uint8Array; format: AudioFormat;
    sha256: string; signal: AbortSignal }): Promise<unknown>;
};

export type TranscriptionOutcome =
  | { state: "failed"; audioSha256: string;
      reason: "unintelligible" | "provider-error" | "timeout" | "invalid-response" }
  | { state: "needs-information" | "needs-human-review";
      audioSha256: string; providerName: string; providerVersion: string;
      original: IntakeSource; durationMs: number;
      uncertainties: Uncertainty[]; segments: TranscriptSegment[] };

function validateAudio(bytes: Uint8Array, format: AudioFormat): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12
    || bytes.byteLength > MAX_AUDIO_BYTES
    || !["audio/wav", "audio/mpeg", "audio/mp4"].includes(format)) {
    throw new TypeError("Unsupported or unbounded original audio");
  }
  const has = (offset: number, s: string) => [...s].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const wav = format === "audio/wav" && has(0, "RIFF") && has(8, "WAVE");
  const mp3 = format === "audio/mpeg" && (has(0, "ID3")
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  const mp4 = format === "audio/mp4" && has(4, "ftyp");
  if (!wav && !mp3 && !mp4) throw new TypeError("Original audio header does not match declared format");
}

function validSpan(text: string, row: any): boolean {
  return row && Number.isSafeInteger(row.start) && Number.isSafeInteger(row.end)
    && row.start >= 0 && row.end > row.start && row.end <= text.length
    && typeof row.excerpt === "string"
    && text.slice(row.start, row.end) === row.excerpt;
}

// Provider responses are untrusted data, never executable accessors or
// decorated arrays. Inspect descriptors BEFORE reading any values.
function exactData(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => {
    if (typeof key !== "string" || !fields.includes(key)) return false;
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field?.enumerable === true && Object.hasOwn(field, "value");
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

function parseProviderReply(reply: unknown) {
  if (exactData(reply, ["status"]) && reply.status === "unintelligible") return null;
  if (!exactData(reply, ["status", "text", "durationMs", "uncertainties", "segments"])) {
    throw new TypeError("Unverified transcription provider response");
  }
  const obj = reply;
  if (obj.status !== "ok" || typeof obj.text !== "string"
    || obj.text.trim().length === 0 || Buffer.byteLength(obj.text, "utf8") > MAX_TEXT_BYTES
    || !Number.isSafeInteger(obj.durationMs) || (obj.durationMs as number) <= 0
    || (obj.durationMs as number) > MAX_DURATION_MS
    || !denseDataArray(obj.uncertainties, 0, MAX_UNCERTAINTIES)
    || !denseDataArray(obj.segments, 1, MAX_SEGMENTS)) {
    throw new TypeError("Unverified transcription provider response");
  }
  const text = obj.text;
  // A provider cannot mark malformed text extraction-ready: reuse the
  // existing immutable source validation, including Unicode and NUL bounds.
  validateIntakeSource({kind: "transcript", text, transcriptionSucceeded: true});
  const durationMs = obj.durationMs as number;
  const uncertainties = obj.uncertainties as Uncertainty[];
  const segments = obj.segments as TranscriptSegment[];
  for (const u of uncertainties) {
    if (!exactData(u, ["start", "end", "excerpt", "reason"])
      || !validSpan(text, u)
      || !["unclear-speech", "ambiguous-number", "other"].includes(u.reason)) {
      throw new TypeError("Invalid transcription uncertainty");
    }
  }
  const sortedUncertainties = [...uncertainties].sort((a, b) => a.start - b.start);
  for (let index = 1; index < sortedUncertainties.length; index++) {
    if (sortedUncertainties[index].start < sortedUncertainties[index - 1].end) {
      throw new TypeError("Overlapping transcription uncertainties");
    }
  }
  let previousTextEnd = 0, previousTimeEnd = 0;
  for (const s of segments) {
    if (!exactData(s, ["start", "end", "excerpt", "startMs", "endMs"])
      || !validSpan(text, s) || !Number.isSafeInteger(s.startMs)
      || !Number.isSafeInteger(s.endMs)
      || s.startMs < previousTimeEnd || s.start < previousTextEnd
      || s.endMs <= s.startMs || s.endMs > durationMs) {
      throw new TypeError("Invalid transcript time segment");
    }
    if (!NON_SPEECH_GAP.test(text.slice(previousTextEnd, s.start))) {
      throw new TypeError("Unanchored substantive transcript text");
    }
    previousTextEnd = s.end;
    previousTimeEnd = s.endMs;
  }
  if (!NON_SPEECH_GAP.test(text.slice(previousTextEnd))) {
    throw new TypeError("Unanchored substantive transcript text");
  }
  // Return detached, whitelisted evidence: a provider may reuse its own
  // response buffers after this promise settles. Gaps for spaces/punctuation
  // remain permitted between nonoverlapping transcript and time segments.
  return {
    text, durationMs,
    uncertainties: uncertainties.map(u => ({
      start: u.start, end: u.end, excerpt: u.excerpt, reason: u.reason,
    })),
    segments: segments.map(s => ({
      start: s.start, end: s.end, excerpt: s.excerpt,
      startMs: s.startMs, endMs: s.endMs,
    })),
  };
}

/** Provider is a server-owned implementation. This function never stores bytes
 * or sends text, quotes, approvals, prices, or credentials to any endpoint. */
export async function transcribeOriginalAudio(
  bytes: Uint8Array, format: AudioFormat, provider: TranscriptionProvider,
  timeoutMs = 30_000,
): Promise<TranscriptionOutcome> {
  validateAudio(bytes, format);
  if (!provider || typeof provider.recognize !== "function" || typeof provider.name !== "string"
    || !provider.name.trim() || typeof provider.version !== "string" || !provider.version.trim()
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("Valid configured transcription provider and deadline required");
  }
  // Never hand a mutable caller-owned buffer to an external provider. Hash
  // exactly the private copy handed off for recognition.
  const audioSnapshot = Uint8Array.from(bytes);
  validateAudio(audioSnapshot, format);
  const audioSha256 = createHash("sha256").update(audioSnapshot).digest("hex");
  const providerName = provider.name;
  const providerVersion = provider.version;
  const signal = AbortSignal.timeout(timeoutMs);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("transcription deadline exceeded"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let outcome: unknown;
  try {
    // The configured adapter must also cancel upstream requests on abort.
    outcome = await Promise.race([provider.recognize({
      audio:audioSnapshot,format,sha256:audioSha256,signal,
    }), aborted]);
  } catch {
    return {state:"failed",audioSha256,reason:signal.aborted?"timeout":"provider-error"};
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
  // A provider that mutates the handed-off bytes cannot return success under
  // the original audio fingerprint. Keep the original digest for reconciliation.
  if (createHash("sha256").update(audioSnapshot).digest("hex") !== audioSha256) {
    return {state:"failed",audioSha256,reason:"invalid-response"};
  }
  let parsed: ReturnType<typeof parseProviderReply>;
  try { parsed = parseProviderReply(outcome); }
  catch { return {state:"failed",audioSha256,reason:"invalid-response"}; }
  if (!parsed) return {state:"failed",audioSha256,reason:"unintelligible"};
  // An uncertainty blocker may be resolved only by a separate human correction.
  const needsInformation = parsed.uncertainties.length > 0;
  return {
    state: needsInformation ? "needs-information" : "needs-human-review",
    audioSha256, providerName, providerVersion,
    original:{kind:"transcript",text:parsed.text,transcriptionSucceeded:!needsInformation},
    durationMs:parsed.durationMs, uncertainties:parsed.uncertainties,segments:parsed.segments,
  };
}
