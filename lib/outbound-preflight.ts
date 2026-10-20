import {createHash} from "node:crypto";

/** Static, provider-free preflight only. Never an authorization to send. */
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const EMAIL = /^[a-z0-9][a-z0-9.!#$%&'*+/=?^_`{|}~-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type DeliveryRevision = {
  organizationId: string;
  proposalId: string;
  revision: number;
  sourceSha256: string;
  policySha256: string;
  contentSha256: string;
  qaSha256: string;
};

export type DeliveryIntent = DeliveryRevision & {
  recipient: string;
  idempotencyKey: string;
};

export type ReviewedProposal = DeliveryRevision & {
  recipient: string;
  reviewState: "reviewed" | "draft" | "revoked";
};

export type InternalReviewReceipt = DeliveryRevision & {
  role: "operator" | "contractor";
  actorId: string;
};

export type RecipientSuppression = {
  organizationId: string;
  recipient: string;
  state: "clear" | "opted_out" | "bounced" | "unknown";
  version: number;
};

export type DispatchHistory = {
  idempotencyKey: string;
  state: "absent" | "reserved" | "sent" | "unknown";
};

const REVISION_KEYS = [
  "organizationId", "proposalId", "revision", "sourceSha256",
  "policySha256", "contentSha256", "qaSha256",
] as const;

/** Restrict inputs to ordinary, entirely enumerable, own data properties.
 * Does not substitute for authenticating the upstream server-owned records. */
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return d?.enumerable === true && Object.hasOwn(d, "value");
  });
}

function validRevision(value: unknown, additional: readonly string[]): value is DeliveryRevision {
  if (!exact(value, [...REVISION_KEYS, ...additional])) return false;
  const record = value as unknown as Record<string, unknown>;
  return typeof record.organizationId === "string" && UUID.test(record.organizationId)
    && typeof record.proposalId === "string" && UUID.test(record.proposalId)
    && Number.isSafeInteger(record.revision) && (record.revision as number) >= 1
    && REVISION_KEYS.slice(3).every(key =>
      typeof record[key] === "string" && SHA.test(record[key] as string));
}

function safeAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254
    && value === value.toLowerCase() && EMAIL.test(value);
}

function sameRevision(a: DeliveryRevision, b: DeliveryRevision): boolean {
  return REVISION_KEYS.every(key => a[key] === b[key]);
}

/** Stable identity for server-side conditional reservation. Hash is not a
 * signature, does not lock a database row, and is not an authorization token. */
export function deliveryIdempotencyKey(value: DeliveryRevision & {recipient: string}): string {
  if (!validRevision(value, ["recipient"]) || !safeAddress(value.recipient)) {
    throw new TypeError("Invalid proposed delivery identity");
  }
  return "dryrun_" + createHash("sha256")
    .update(JSON.stringify([...REVISION_KEYS.map(key => value[key]), value.recipient]))
    .digest("hex");
}

export type DeliveryDryRunResult = {
  state: "blocked" | "consistent-internal-only";
  blockers: string[];
};

/** All inputs MUST eventually come from tenant-authorized, independently
 * authenticated server reads. No provider call, API route, network operation,
 * approval, reservation, or send can occur here. */
export function evaluateDeliveryDryRun(
  intent: DeliveryIntent,
  proposal: ReviewedProposal,
  receipts: readonly InternalReviewReceipt[],
  suppression: RecipientSuppression,
  dispatch: DispatchHistory,
): DeliveryDryRunResult {
  if (!validRevision(intent, ["recipient", "idempotencyKey"])
    || !validRevision(proposal, ["recipient", "reviewState"])
    || !safeAddress(intent.recipient) || !safeAddress(proposal.recipient)
    || typeof intent.idempotencyKey !== "string"
    || !/^dryrun_[0-9a-f]{64}$/.test(intent.idempotencyKey)
    || !["reviewed", "draft", "revoked"].includes(proposal.reviewState)
    || !Array.isArray(receipts)
    || Object.getPrototypeOf(receipts) !== Array.prototype
    || receipts.length !== 2
    || Reflect.ownKeys(receipts).length !== 3
    || ![0, 1].every(i => Object.hasOwn(
      Object.getOwnPropertyDescriptor(receipts, String(i)) ?? {}, "value"))
    || !receipts.every(item => validRevision(item, ["role", "actorId"])
      && ["operator", "contractor"].includes(item.role)
      && typeof item.actorId === "string" && UUID.test(item.actorId))
    || !exact(suppression, ["organizationId", "recipient", "state", "version"])
    || !exact(dispatch, ["idempotencyKey", "state"])
    || typeof suppression.organizationId !== "string"
    || !safeAddress(suppression.recipient)
    || !["clear", "opted_out", "bounced", "unknown"].includes(suppression.state)
    || !Number.isSafeInteger(suppression.version) || suppression.version < 1
    || typeof dispatch.idempotencyKey !== "string"
    || !["absent", "reserved", "sent", "unknown"].includes(dispatch.state)) {
    throw new TypeError("Invalid internal delivery preflight evidence");
  }

  const blockers: string[] = [];
  if (!sameRevision(intent, proposal) || proposal.reviewState !== "reviewed") {
    blockers.push("Proposal is not the exact currently reviewed revision");
  }
  if (intent.recipient !== proposal.recipient) {
    blockers.push("Recipient differs from reviewed proposal");
  }
  if (intent.idempotencyKey !== deliveryIdempotencyKey({
    organizationId: intent.organizationId, proposalId: intent.proposalId,
    revision: intent.revision, sourceSha256: intent.sourceSha256,
    policySha256: intent.policySha256, contentSha256: intent.contentSha256,
    qaSha256: intent.qaSha256, recipient: intent.recipient,
  })) {
    blockers.push("Idempotency key differs from exact proposal and recipient");
  }
  if (receipts.some(item => !sameRevision(item, intent))
    || new Set(receipts.map(item => item.role)).size !== 2
    || new Set(receipts.map(item => item.actorId)).size !== 2) {
    blockers.push("Two distinct, exact-revision internal reviewer receipts are required");
  }
  if (suppression.organizationId !== intent.organizationId
    || suppression.recipient !== intent.recipient || suppression.state !== "clear") {
    blockers.push("Recipient suppression is not confirmed clear");
  }
  if (dispatch.idempotencyKey !== intent.idempotencyKey
    || dispatch.state !== "absent") {
    blockers.push("Prior, in-flight or unknown dispatch record blocks replay");
  }
  return {
    state: blockers.length ? "blocked" : "consistent-internal-only",
    blockers,
  };
}
