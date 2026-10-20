import type {DeliveryIntent} from "./outbound-preflight.ts";
import type {DeliveryEvent} from "./delivery-event-projection.ts";
import type {FollowUpPolicy, FollowUpRecord} from "./follow-up-assessment.ts";
import {classifySimulatedDeliveryTriage, type DeliveryTriage} from "./delivery-triage.ts";
import {classifySimulatedRecipientAwareTriage} from "./recipient-aware-delivery-triage.ts";
import type {SyntheticRecipientHistory} from "./recipient-suppression-history.ts";

export type SyntheticReviewEntry = {
  intent: DeliveryIntent;
  events: readonly DeliveryEvent[];
  policy: FollowUpPolicy;
  previousAttempts: readonly FollowUpRecord[];
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ENTRY_FIELDS = ["intent", "events", "policy", "previousAttempts"];
const CATEGORIES: readonly DeliveryTriage["category"][] = [
  "contact-suppressed",
  "reply-needs-review",
  "consent-needs-verification",
  "delivery-needs-verification",
  "waiting-for-cooldown",
  "external-authorization-required",
];

export type SimulatedReviewSummary = {
  state: "review-simulation-only";
  reviewedCases: number;
  attention: {
    stopContact: number;
    operatorReview: number;
    deferred: number;
  };
  categories: {category: DeliveryTriage["category"]; count: number}[];
};

function ownData(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}
function denseArray(value: unknown): value is SyntheticReviewEntry[] {
  return Array.isArray(value)
    && Object.getPrototypeOf(value) === Array.prototype
    && value.length >= 1 && value.length <= 100
    && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({length: value.length}, (_, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    }).every(Boolean);
}

/** Pure aggregate for a single FICTIONAL tenant. Does not return case identifiers,
 * emails, proposal IDs or idempotency keys, nor persist anything. Never grants
 * access to a tenant, proves real consent or authorizes a send. */
export function summarizeSyntheticDeliveryReview(
  organizationId: string,
  entries: readonly SyntheticReviewEntry[],
  nowUtc: string,
  historicalStreams?: readonly (readonly SyntheticRecipientHistory[])[],
): SimulatedReviewSummary {
  // An explicit history matrix must cover *each* case. Silent partial
  // history would conceal prior recipient suppression in the aggregate.
  if (historicalStreams !== undefined &&
    (!Array.isArray(historicalStreams)
      || Object.getPrototypeOf(historicalStreams) !== Array.prototype
      || historicalStreams.length !== entries.length
      || Reflect.ownKeys(historicalStreams).length !== historicalStreams.length + 1
      || !Array.from({length: historicalStreams.length}, (_,i) => {
        const item = Object.getOwnPropertyDescriptor(historicalStreams, String(i));
        return item?.enumerable === true && Object.hasOwn(item, "value");
      }).every(Boolean))) {
    throw new TypeError("Invalid recipient history matrix");
  }
  if (typeof organizationId !== "string" || !UUID.test(organizationId)
    || !denseArray(entries)) {
    throw new TypeError("Invalid simulated review batch");
  }
  const seen = new Set<string>();
  const counts = new Map<DeliveryTriage["category"], number>(
    CATEGORIES.map(category => [category, 0]),
  );
  const attention = {stopContact: 0, operatorReview: 0, deferred: 0};
  for (const entry of entries) {
    if (!ownData(entry, ENTRY_FIELDS)) {
      throw new TypeError("Invalid simulated review entry");
    }
    // The underlying evaluators reject untrusted shapes, impossible timelines,
    // replay conflicts and invalid timestamps/consent/attempt histories.
    const result = historicalStreams === undefined
      ? classifySimulatedDeliveryTriage(
        entry.intent, entry.events, entry.policy, entry.previousAttempts, nowUtc,
      )
      : classifySimulatedRecipientAwareTriage(
        entry.intent, entry.events, entry.policy, entry.previousAttempts,
        historicalStreams[seen.size], nowUtc,
      );
    if (entry.intent.organizationId !== organizationId) {
      throw new TypeError("Cross-tenant simulated review entry");
    }
    const key = entry.intent.idempotencyKey;
    if (seen.has(key)) {
      throw new TypeError("Duplicate simulated review identity");
    }
    seen.add(key);
    counts.set(result.category, (counts.get(result.category) ?? 0) + 1);
    if (result.attention === "stop-contact") attention.stopContact++;
    else if (result.attention === "operator-review") attention.operatorReview++;
    else attention.deferred++;
  }
  // No identifying tokens, recipient addresses, event histories or consent
  // records appear in this aggregate: only deterministic fictional counts.
  return {
    state: "review-simulation-only",
    reviewedCases: entries.length,
    attention,
    categories: CATEGORIES.map(category => ({category, count: counts.get(category) ?? 0})),
  };
}
