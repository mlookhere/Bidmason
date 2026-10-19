/** Shared inert-data preflight for internal proposal drafts. The input is
 * read from a trusted tenant adapter, but may still contain hostile nested
 * objects before any lineage verifier, receipt check or JSON fingerprint. */
/**
 * Authenticated database reads can still contain unsafe adapter objects.
 * Reject accessors, custom serializers, hidden/symbol fields, array holes,
 * prototypes and non-JSON primitives before calling correction verification
 * or JSON.stringify. A bounded walk also prevents cyclic/huge audit graphs.
 */
export function inertEvidenceGraph(value: unknown): boolean {
  const seen = new Set<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 4096 || depth > 24) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      return true;
    }
    if (typeof item === "number") return Number.isFinite(item);
    if (!item || typeof item !== "object" || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype
        || item.length > 256
        || Reflect.ownKeys(item).length !== item.length + 1) return false;
      for (let i = 0; i < item.length; i++) {
        const entry = Object.getOwnPropertyDescriptor(item, String(i));
        if (entry?.enumerable !== true || !Object.hasOwn(entry, "value")
          || !visit(entry.value, depth + 1)) return false;
      }
      seen.delete(item);
      return true;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      return false;
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > 256) return false;
    for (const key of keys) {
      if (typeof key !== "string") return false;
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (field?.enumerable !== true || !Object.hasOwn(field, "value")
        || !visit(field.value, depth + 1)) return false;
    }
    seen.delete(item);
    return true;
  }
  return visit(value, 0);
}

/** Detach a validated authorized store read before the next awaited call.
 * Without this snapshot a storage adapter can change previously inspected
 * fields during async policy lookup; a later read could execute a new getter
 * or silently price different data. This snapshot grants no authorization. */
export function snapshotInertEvidence<T>(value: T, failure: string): T {
  if (!inertEvidenceGraph(value)) throw new Error(failure);
  try {
    return structuredClone(value);
  } catch {
    throw new Error(failure);
  }
}
