/**
 * Compose a trusted server-owned request abort with a fixed provider budget.
 * A timed-out or cancelled HTTP request must never fall back to an unbounded
 * fetch. A caller cannot extend the provider timeout via this helper.
 */
export function evidenceProviderSignal(
  requestSignal: AbortSignal | undefined,
  timeoutMs: 7_000 | 10_000 | 30_000,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return requestSignal ? AbortSignal.any([timeout, requestSignal]) : timeout;
}
