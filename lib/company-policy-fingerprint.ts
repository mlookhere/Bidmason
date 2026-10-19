import { createHash } from "node:crypto";
import type { VersionedEconomicsPolicy } from "./company-economics.ts";

/**
 * One canonical byte representation for company policy history, economics
 * previews and the private, server-owned PostgreSQL activation port.
 *
 * Sort keys by Unicode code-unit order (NOT localeCompare, which depends on
 * locale/collation). This is a consistency fingerprint, NOT an authorization
 * signature. An actual current approved policy must still be read from the
 * tenant-owned database and approved by independently verified actors.
 */
function serialize(value: unknown, depth: number): string {
  if (depth > 32) throw new TypeError("Policy nesting exceeds safe limit");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Policy values must be safe integral numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new TypeError("Policy array exceeds safe limit");
    return "[" + value.map(item => serialize(item, depth + 1)).join(",") + "]";
  }
  if (!value || typeof value !== "object"
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError("Policy contains unsupported data");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length > 10000) throw new TypeError("Policy object exceeds safe limit");
  return "{" + keys.map(key => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new TypeError("Policy contains forbidden object keys");
    }
    return JSON.stringify(key) + ":" + serialize(record[key], depth + 1);
  }).join(",") + "}";
}

/** UTF-8 bytes to supply ONLY from an authenticated trusted policy adapter. */
export function canonicalCompanyPolicyText(policy: VersionedEconomicsPolicy): string {
  const json = serialize(policy, 0);
  if (Buffer.byteLength(json, "utf8") > 65536) {
    throw new TypeError("Canonical company policy exceeds database bound");
  }
  return json;
}

export function companyPolicySha256(policy: VersionedEconomicsPolicy): string {
  return createHash("sha256").update(canonicalCompanyPolicyText(policy), "utf8")
    .digest("hex");
}
