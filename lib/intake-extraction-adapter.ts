import { prepareExtractionReview, type IntakeSource, type ServiceCandidate,
  type ExtractionReview } from "./intake-review.ts";

const MAX_RESPONSE_BYTES = 32 * 1024;
const FIELDS = ["end", "excerpt", "serviceCode", "start", "units"] as const;

/**
 * Parse a bounded untrusted extractor response. Provider output is NEVER
 * an approved decision, executable instruction, source text or price.
 *
 * Required JSON: { "candidates": [{ serviceCode, units, start, end, excerpt }] }
 * Offsets refer to the original's UTF-16 character indexes.
 */
export function parseUntrustedExtraction(
  original: IntakeSource, rawResponse: string,
): ExtractionReview {
  if (typeof rawResponse !== "string" || rawResponse.length === 0
    || Buffer.byteLength(rawResponse, "utf8") > MAX_RESPONSE_BYTES) {
    throw new TypeError("Unbounded or missing extraction response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    throw new TypeError("Extraction provider must return valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "candidates")) {
    throw new TypeError("Extractor response contains unsupported directives");
  }
  const items = (parsed as { candidates: unknown }).candidates;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    throw new TypeError("Extractor must provide one to 50 candidates");
  }
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).length !== FIELDS.length
      || FIELDS.some(key => !Object.hasOwn(item, key))) {
      throw new TypeError("Extractor candidate contains unsupported fields");
    }
  }
  // Always let the provenance validator check actual source bytes, units,
  // canonical service codes and valid UTF-16 spans before review is offered.
  return prepareExtractionReview(original, items as ServiceCandidate[]);
}
