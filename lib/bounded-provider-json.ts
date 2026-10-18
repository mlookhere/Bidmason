/** Safe bounded JSON provider body reader (never exposed to a browser).
 * Individual callers must supply their own lower cap; the maximum here is
 * sized for a 100-organization membership list, not public HTTP payloads.
 */
const MAX_JSON_BYTES = 64 * 1024;
const MAX_MS = 10_000;

export async function readBoundedProviderJson(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  deadlineMs: number,
  requestSignal?: AbortSignal,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_JSON_BYTES
    || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_MS) {
    throw new RangeError("Invalid private provider response limit");
  }
  if (!body || requestSignal?.aborted) throw new Error("Private provider body unavailable");
  const reader = body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let total = 0;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Private provider body deadline")), deadlineMs);
  });
  const cancelled = new Promise<never>((_, reject) => {
    if (!requestSignal) return;
    onAbort = () => reject(new Error("Private provider body cancelled"));
    requestSignal.addEventListener("abort", onAbort, { once: true });
    if (requestSignal.aborted) onAbort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline, cancelled]);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0
        || value.byteLength > maxBytes - total) {
        throw new Error("Private provider body invalid or oversized");
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
    if (total < 1 || requestSignal?.aborted) {
      throw new Error("Private provider body empty or cancelled");
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0,total)));
    finished = true;
    return parsed;
  } finally {
    clearTimeout(timer);
    if (onAbort) requestSignal?.removeEventListener("abort", onAbort);
    if (!finished) {
      try { void reader.cancel().catch(() => {}); } catch { /* never await hostile cancellation */ }
    }
    reader.releaseLock();
  }
}
