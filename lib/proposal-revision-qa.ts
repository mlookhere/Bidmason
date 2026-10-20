import { createHash } from "node:crypto";

/** Read-only, non-authoritative QA and approval-consistency checks.
 * Callers must separately enforce authenticated roles and atomic persistence. */
const CHECKS = ["pricing", "scope", "claims", "recipient", "pdf-layout"] as const;
type CheckName = (typeof CHECKS)[number];
type CheckState = "passed" | "failed" | "not_run";
type Role = "operator" | "contractor";
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export type ProposalRevisionIdentity = {
  organizationId: string;
  proposalId: string;
  revision: number;
  sourceSha256: string;
  policySha256: string;
  contentSha256: string;
};

export type ProposalQaCheck = {
  check: CheckName;
  state: CheckState;
  evidenceSha256: string | null;
  note: string;
};

export type ProposalQaReport = {
  state: "internal-qa-only";
  identity: ProposalRevisionIdentity;
  checks: ProposalQaCheck[];
  status: "passed" | "blocked";
  qaSha256: string;
};

export type ProposalReviewReceipt = ProposalRevisionIdentity & {
  role: Role;
  actorId: string;
  qaSha256: string;
};

/** Exact own-data objects only: no hidden, inherited, symbol or getter directives. */
function ownData(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== names.length) return false;
  return names.every(name => {
    const d = Object.getOwnPropertyDescriptor(value, name);
    return d?.enumerable === true && Object.hasOwn(d, "value");
  });
}

function dense(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return Array.from({length: value.length}, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    return d?.enumerable === true && Object.hasOwn(d, "value");
  }).every(Boolean);
}

function identity(value: unknown): ProposalRevisionIdentity {
  const keys = ["organizationId", "proposalId", "revision",
    "sourceSha256", "policySha256", "contentSha256"];
  if (!ownData(value, keys)
    || typeof value.organizationId !== "string" || !UUID.test(value.organizationId)
    || typeof value.proposalId !== "string" || !UUID.test(value.proposalId)
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || ["sourceSha256", "policySha256", "contentSha256"].some(key =>
      typeof value[key] !== "string" || !SHA.test(value[key] as string))) {
    throw new TypeError("Invalid proposal revision identity");
  }
  return Object.fromEntries(keys.map(key => [key, value[key]])) as ProposalRevisionIdentity;
}

function checkRow(value: unknown): ProposalQaCheck {
  if (!ownData(value, ["check", "state", "evidenceSha256", "note"])
    || !CHECKS.includes(value.check as CheckName)
    || !["passed", "failed", "not_run"].includes(value.state as string)
    || typeof value.note !== "string" || value.note.length > 200
    || (value.state === "passed"
      ? (typeof value.evidenceSha256 !== "string"
        || !SHA.test(value.evidenceSha256) || value.note !== "")
      : (value.evidenceSha256 !== null || value.note.trim().length === 0))) {
    throw new TypeError("Malformed proposal QA observation");
  }
  return {check: value.check as CheckName, state: value.state as CheckState,
    evidenceSha256: value.evidenceSha256 as string | null, note: value.note};
}

/** Missing required checks become explicit not_run blockers, never implicit success. */
export function buildProposalQaReport(
  revision: ProposalRevisionIdentity, observations: readonly ProposalQaCheck[],
): ProposalQaReport {
  const frozenIdentity = identity(revision);
  if (!dense(observations, CHECKS.length)) {
    throw new TypeError("Invalid proposal QA observations");
  }
  const observed = new Map<CheckName, ProposalQaCheck>();
  for (const raw of observations) {
    const row = checkRow(raw);
    if (observed.has(row.check)) throw new Error("Duplicate proposal QA observation");
    observed.set(row.check, row);
  }
  const checks = CHECKS.map(check => observed.get(check) ?? {
    check, state: "not_run" as const, evidenceSha256: null, note: "Not executed",
  });
  const status = checks.every(check => check.state === "passed") ? "passed" : "blocked";
  const qaSha256 = createHash("sha256")
    .update(JSON.stringify([frozenIdentity, checks])).digest("hex");
  return {state: "internal-qa-only", identity: frozenIdentity, checks, status, qaSha256};
}

/** Consistency only: matching receipts do not prove human identity, permissions,
 * historical approval, or permission to deliver a customer proposal. */
export function evaluateProposalReceiptConsistency(
  report: ProposalQaReport, receipts: readonly ProposalReviewReceipt[],
): { state: "consistent-internal-only" | "blocked"; reason: string } {
  if (!ownData(report, ["state", "identity", "checks", "status", "qaSha256"])
    || report.state !== "internal-qa-only"
    || !dense(report.checks, CHECKS.length)
    || report.checks.length !== CHECKS.length
    || !dense(receipts, 2)) {
    throw new TypeError("Invalid internal proposal QA report or receipts");
  }
  const verified = buildProposalQaReport(report.identity, report.checks);
  if (verified.qaSha256 !== report.qaSha256 || verified.status !== report.status
    || JSON.stringify(verified.checks) !== JSON.stringify(report.checks)) {
    throw new Error("Proposal QA report integrity mismatch");
  }
  if (verified.status !== "passed") return {state:"blocked",reason:"Required QA not passed"};
  if (receipts.length !== 2) return {state:"blocked",reason:"Both review receipts required"};
  const roles = new Set<Role>(), actors = new Set<string>();
  for (const item of receipts) {
    if (!ownData(item, ["role", "actorId", "organizationId", "proposalId", "revision",
      "sourceSha256", "policySha256", "contentSha256", "qaSha256"])
      || !["operator", "contractor"].includes(item.role)
      || typeof item.actorId !== "string" || !UUID.test(item.actorId)
      || item.qaSha256 !== verified.qaSha256
      || ["organizationId", "proposalId", "revision", "sourceSha256",
        "policySha256", "contentSha256"].some(key =>
        item[key] !== verified.identity[key as keyof ProposalRevisionIdentity])) {
      return {state:"blocked",reason:"Receipt does not match exact proposal revision"};
    }
    roles.add(item.role);
    actors.add(item.actorId);
  }
  if (roles.size !== 2 || actors.size !== 2) {
    return {state:"blocked",reason:"Distinct operator and contractor receipts required"};
  }
  return {state:"consistent-internal-only",reason:
    "Receipts match the internal snapshot; real independent authorization remains required"};
}
