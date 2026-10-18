/** One fixed-size, receipt-bound buffer; no per-fragment allocation. */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_MS = 25_000;

export async function readBoundedPrivateStorage(
  body: ReadableStream<Uint8Array> | null,
  expected: number,
  deadlineMs = MAX_MS,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > MAX_BYTES
    || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_MS) {
    throw new RangeError("Invalid private evidence read limits");
  }
  if (!body) throw new Error("Private evidence download has no body");
  const reader = body.getReader();
  const result = new Uint8Array(expected);
  let total = 0;
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Private evidence stream read timed out")), deadlineMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        throw new Error("Private evidence returned invalid binary chunk");
      }
      if (value.byteLength > expected - total) {
        throw new Error("Private evidence exceeds expected size");
      }
      result.set(value, total);
      total += value.byteLength;
    }
    if (total !== expected) throw new Error("Private evidence size mismatch");
    completed = true;
    return result;
  } finally {
    clearTimeout(timer);
    if (!completed) {
      // Never await hostile/buggy provider cancellation promises.
      try { void reader.cancel().catch(() => {}); } catch { /* fail closed */ }
    }
    reader.releaseLock();
  }
}
