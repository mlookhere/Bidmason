import { canonicalCompanyPolicyText, companyPolicySha256 } from "./company-policy-fingerprint.ts";
import type { VersionedEconomicsPolicy } from "./company-economics.ts";

type RevisionStatus = "draft" | "approved" | "rejected";

export type PolicyRevision = {
  organizationId: string;
  revision: number;
  status: RevisionStatus;
  submittedBy: string;
  reviewedBy: string | null;
  policySha256: string;
  policy: VersionedEconomicsPolicy;
};

export type PolicyHistory = {
  organizationId: string;
  activeRevision: number | null;
  revisions: PolicyRevision[];
};

type ExpectedHead = { expectedRevision: number; expectedSha256: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVICE = /^[a-z][a-z0-9_-]{0,63}$/;

function actor(value: string): void {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError("An authenticated actor identifier is required");
  }
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Check business schema after canonical JSON parsing, not on caller objects. */
function hasFields(value: unknown, required: string[], optional: string[] = []): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => required.includes(key) || optional.includes(key));
}

function cents(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function bps(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10000;
}

/** Validate even services that are pending and cannot yet be quoted. */
function validatePolicy(policy: VersionedEconomicsPolicy, revision: number): void {
  const p = policy?.pricing;
  if (!policy || policy.revision !== revision
    || !hasFields(policy, ["revision", "pricing", "tax"],
      ["excludedServiceCodes", "unitDirectCostsCents"])
    || !hasFields(p, ["policyId", "currency", "minimum", "calculationOrder", "services"])
    || !hasFields(p?.minimum, ["rule", "cents"])
    || !hasFields(policy.tax, ["method", "bps"])
    || !p || p.currency !== "USD"
    || typeof p.policyId !== "string" || !p.policyId.trim()
    || !["none", "per-line", "quote"].includes(p.minimum?.rule)
    || !cents(p.minimum?.cents)
    || (p.minimum.rule === "none" && p.minimum.cents !== 0)
    || !["surcharge-then-discount", "discount-then-surcharge"].includes(p.calculationOrder)
    || !p.services || typeof p.services !== "object" || Array.isArray(p.services)
    || Object.keys(p.services).length === 0
    || !policy.tax || !["none", "exclusive-all-charged"].includes(policy.tax.method)
    || !bps(policy.tax.bps)
    || (policy.tax.method === "none" && policy.tax.bps !== 0)) {
    throw new TypeError("Invalid company-owned policy revision");
  }
  for (const [code, rule] of Object.entries(p.services)) {
    if (!SERVICE.test(code)
      || !hasFields(rule, ["label", "unit", "rateCents", "billing"],
        ["surchargeBps", "discountBps", "optionalAddon"])
      || !rule || typeof rule.label !== "string"
      || !rule.label.trim() || typeof rule.unit !== "string" || !rule.unit.trim()
      || !cents(rule.rateCents)
      || (rule.optionalAddon !== undefined && typeof rule.optionalAddon !== "boolean")
      || !["charged", "included", "pending"].includes(rule.billing)
      || !bps(rule.surchargeBps ?? 0) || !bps(rule.discountBps ?? 0)) {
      throw new TypeError("Invalid service configuration");
    }
  }
  const excluded = policy.excludedServiceCodes ?? [];
  if (!Array.isArray(excluded) || new Set(excluded).size !== excluded.length
    || excluded.some(code => typeof code !== "string"
      || !Object.hasOwn(p.services, code))) {
    throw new TypeError("Invalid company exclusions");
  }
  if (policy.unitDirectCostsCents !== undefined) {
    const costs = policy.unitDirectCostsCents;
    if (!costs || typeof costs !== "object" || Array.isArray(costs)
      || Object.entries(costs).some(([code, amount]) =>
        !Object.hasOwn(p.services, code) || !cents(amount))) {
      throw new TypeError("Invalid company cost schedule");
    }
  }
}

/** Validates persisted history even if no company policy is active yet. */
export function assertValidCompanyPolicyHistory(
  history: PolicyHistory, organizationId: string,
): void {
  actor(organizationId);
  validateHistory(history, organizationId);
}

function validateHistory(history: PolicyHistory, organizationId: string): void {
  if (!history || history.organizationId !== organizationId
    || !Array.isArray(history.revisions)
    || history.revisions.length === 0 || history.revisions.length > 1000) {
    throw new Error("Policy history or tenant does not match");
  }
  let lastApproved: number | null = null;
  for (const [index, item] of history.revisions.entries()) {
    if (!item || item.organizationId !== organizationId
      || item.revision !== index + 1
      || !["draft", "approved", "rejected"].includes(item.status)
      || typeof item.submittedBy !== "string"
      || !UUID.test(item.submittedBy)
      || (item.status === "draft" && item.reviewedBy !== null)
      || (item.status !== "draft"
        && (typeof item.reviewedBy !== "string"
          || !UUID.test(item.reviewedBy)
          || item.reviewedBy === item.submittedBy))) {
      throw new Error("Malformed immutable policy history");
    }
    validatePolicy(item.policy, item.revision);
    if (item.policySha256 !== companyPolicySha256(item.policy)) {
      throw new Error("Policy history integrity check failed");
    }
    if (item.status === "approved") lastApproved = item.revision;
    if (item.status === "draft" && index !== history.revisions.length - 1) {
      throw new Error("A draft cannot be followed by another revision");
    }
  }
  if (history.activeRevision !== lastApproved) {
    throw new Error("Active policy revision does not match approved history");
  }
}

function head(history: PolicyHistory | null, organizationId: string): {
  revision: number; sha256: string | null
} {
  if (!history) return { revision: 0, sha256: null };
  validateHistory(history, organizationId);
  const last = history.revisions.at(-1)!;
  return { revision: last.revision, sha256: last.policySha256 };
}

function checkExpected(actual: {revision: number; sha256: string | null},
  expected: ExpectedHead): void {
  if (!expected || expected.expectedRevision !== actual.revision
    || expected.expectedSha256 !== actual.sha256) {
    throw new Error("Stale policy head; reload before changing company pricing");
  }
}

/** An immutable pure transition. Durable compare-and-swap and authorization
 * MUST happen atomically in the trusted tenant-scoped persistence adapter. */
export function submitPolicyDraft(
  history: PolicyHistory | null,
  request: { organizationId: string; submittedBy: string;
    policy: VersionedEconomicsPolicy } & ExpectedHead,
): PolicyHistory {
  actor(request.organizationId); actor(request.submittedBy);
  const current = head(history, request.organizationId);
  checkExpected(current, request);
  if (history?.revisions.at(-1)?.status === "draft") {
    throw new Error("Existing company policy draft must be reviewed first");
  }
  // Normalize only through the strict serializer. JSON.stringify(value)
  // would invoke a caller-owned toJSON and could persist different prices
  // from those just checked or silently omit hidden approval directives.
  const policy = JSON.parse(canonicalCompanyPolicyText(request.policy))
    as VersionedEconomicsPolicy;
  validatePolicy(policy, current.revision + 1);
  const item: PolicyRevision = {
    organizationId: request.organizationId,
    revision: current.revision + 1,
    status: "draft", submittedBy: request.submittedBy,
    reviewedBy: null, policySha256: companyPolicySha256(policy), policy,
  };
  return {
    organizationId: request.organizationId,
    activeRevision: history?.activeRevision ?? null,
    revisions: [...(history?.revisions ?? []).map(snapshot), item],
  };
}

export function reviewPolicyDraft(
  history: PolicyHistory,
  request: { organizationId: string; reviewedBy: string;
    decision: "approve" | "reject" } & ExpectedHead,
): PolicyHistory {
  actor(request.organizationId); actor(request.reviewedBy);
  const current = head(history, request.organizationId);
  checkExpected(current, request);
  const last = history.revisions.at(-1)!;
  if (last.status !== "draft") throw new Error("Only the current draft can be reviewed");
  if (last.submittedBy === request.reviewedBy) {
    throw new Error("Self approval or rejection is not allowed");
  }
  if (!["approve", "reject"].includes(request.decision)) {
    throw new TypeError("Explicit policy review decision required");
  }
  const updated: PolicyRevision = {
    ...snapshot(last), reviewedBy: request.reviewedBy,
    status: request.decision === "approve" ? "approved" : "rejected",
  };
  return {
    organizationId: request.organizationId,
    activeRevision: request.decision === "approve" ? last.revision : history.activeRevision,
    revisions: [...history.revisions.slice(0, -1).map(snapshot), updated],
  };
}

/** A caller must independently verify tenant membership and active revision
 * from the authoritative database before using this for a preview. */
export function readActivePolicy(
  history: PolicyHistory, organizationId: string,
): VersionedEconomicsPolicy {
  actor(organizationId);
  validateHistory(history, organizationId);
  const approved = history.revisions.find(r => r.revision === history.activeRevision);
  if (!approved || approved.status !== "approved") {
    throw new Error("No approved company policy is available");
  }
  return snapshot(approved.policy);
}
