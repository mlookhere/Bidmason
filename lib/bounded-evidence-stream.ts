/**
 * Internal raw-body reader. Both a declared Content-Length and a hard runtime
 * deadline are required: a client must not hold an upload worker indefinitely
 * after consuming an authenticated database quota reservation.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_READ_MS = 30_000;

export class EvidenceBodyInterrupted extends Error {
  constructor() {
    super("Evidence body was interrupted or took too long");
  }
}

export async function readExactEvidenceBytes(
  body: ReadableStream<Uint8Array> | null,
  expected: number,
  requestSignal: AbortSignal,
  deadlineMs: number = MAX_READ_MS,
): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > MAX_BYTES
    || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1
    || deadlineMs > MAX_READ_MS) {
    throw new RangeError("Invalid bounded evidence read parameters");
  }
  if (!body) return null;

  const reader = body.getReader();
  const controller = new AbortController();
  const onRequestAbort = () => controller.abort();
  requestSignal.addEventListener("abort", onRequestAbort, { once: true });
  if (requestSignal.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), deadlineMs);
  // One shared rejection signal for all chunk reads. Promise.race installs
  // rejection observers even when a read completes first; no orphan rejects.
  const interrupted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new EvidenceBodyInterrupted());
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });

  let done = false;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength === 0) {
        throw new TypeError("Invalid evidence stream chunk");
      }
      // Compare *before* addition; a bogus chunk length cannot overflow safely.
      if (next.value.byteLength > expected - total) return null;
      total += next.value.byteLength;
      // Snapshot each chunk rather than retaining possibly mutable stream
      // storage while awaiting the next chunk.
      chunks.push(Uint8Array.from(next.value));
    }
    if (total !== expected) return null;
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // A disconnect between the final read and commit is never success.
    if (controller.signal.aborted) throw new EvidenceBodyInterrupted();
    done = true;
    return output;
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", onRequestAbort);
    // Do not await cancellation: a malicious custom stream can hang its
    // cancel() handler. The worker has already stopped reading its bytes.
    if (!done) {
      try { void reader.cancel().catch(() => {}); } catch { /* fail closed */ }
    }
    reader.releaseLock();
  }
}
