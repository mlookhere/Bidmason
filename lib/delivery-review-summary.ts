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
  const revisionRecipients = new Set<string>();
  // IDs identify a fictional attempt across this tenant's whole review,
  // not just inside a single proposal's follow-up timeline.
  const attemptIds = new Set<string>();
  // Distinct proposals cannot both claim a fictional contact attempt for
  // the exact same tenant/recipient instant. This is audit consistency,
  // NOT an invented cross-proposal business cooldown or send authority.
  const recipientAttemptTimes = new Map<string, string>();
  const revisionClaims = new Map<string,string>();
  const proposalRevisions = new Map<string,string>();
  const recordRevision = (intent: DeliveryIntent) => {
    // Per-recipient dry-run identities may differ, but the underlying proposal
    // revision's source, policy, content and QA hashes must remain identical.
    const revisionId = JSON.stringify([
      intent.proposalId, intent.revision, intent.recipient,
    ]);
    const previous = revisionClaims.get(revisionId);
    if (previous !== undefined && previous !== intent.idempotencyKey) {
      throw new TypeError("Conflicting synthetic CRM revision across streams");
    }
    const proposalRevision = JSON.stringify([intent.proposalId, intent.revision]);
    const fingerprint = JSON.stringify([
      intent.sourceSha256, intent.policySha256, intent.contentSha256, intent.qaSha256,
    ]);
    const earlier = proposalRevisions.get(proposalRevision);
    if (earlier !== undefined && earlier !== fingerprint) {
      throw new TypeError("Conflicting synthetic CRM proposal revision across recipients");
    }
    revisionClaims.set(revisionId, intent.idempotencyKey);
    proposalRevisions.set(proposalRevision, fingerprint);
  };
  const eventClaims = new Map<string,{claim:string; current:boolean}>();
  const recordEventIds = (stream: SyntheticRecipientHistory, current: boolean) => {
    for (const event of stream.events) {
      const claim = JSON.stringify([
        stream.intent.idempotencyKey, event.organizationId, event.recipient,
        event.kind, event.observedAt,
      ]);
      const existing = eventClaims.get(event.eventId);
      if (existing && existing.claim !== claim) {
        throw new TypeError(existing.current && current
          ? "Cross-proposal simulated review event ID collision"
          : "Conflicting synthetic CRM event ID across streams");
      }
      if (!existing) eventClaims.set(event.eventId, {claim, current});
    }
  };
  const counts = new Map<DeliveryTriage["category"], number>(
    CATEGORIES.map(category => [category, 0]),
  );
  const attention = {stopContact: 0, operatorReview: 0, deferred: 0};
  // Reconcile known fictional recipient signals across all case records,
  // regardless of which proposal supplied the evidence. Do not infer that
  // the supplied batch is a complete or authorized recipient history.
  const reviewed: {recipient: string; result: DeliveryTriage;
    attempts: readonly FollowUpRecord[]}[] = [];
  const recipientHolds = new Map<string, "stop-contact" | "reply-review">();
  // Every caller-supplied stop signal belongs to the recipient, not merely
  // to its proposal. Check attempts against the earliest observed stop only
  // after all current and historical streams have passed existing validation.
  const earliestStop = new Map<string, string>();
  const observeStops = (recipient: string, events: readonly DeliveryEvent[]) => {
    for (const event of events) {
      if (!["recipient_replied", "recipient_opted_out", "provider_bounced",
        "provider_complained"].includes(event.kind)) continue;
      const previous = earliestStop.get(recipient);
      if (previous === undefined || event.observedAt < previous) {
        earliestStop.set(recipient, event.observedAt);
      }
    }
  };
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
    // Different hashes cannot create multiple delivery records for the same
    // immutable proposal revision and recipient, even with distinct keys.
    const revisionRecipient = JSON.stringify([
      entry.intent.proposalId, entry.intent.revision, entry.intent.recipient,
    ]);
    if (revisionRecipients.has(revisionRecipient)) {
      throw new TypeError("Conflicting simulated proposal revision in CRM summary");
    }
    revisionRecipients.add(revisionRecipient);
    // Compare immutable revision claims after per-stream validation, including
    // earlier evidence which may be repeated in multiple fictional cases.
    recordRevision(entry.intent);
    recordEventIds({intent: entry.intent, events: entry.events}, true);
    // Each entry's follow-up assessor has already validated its own
    // chronology and exact duplicate replays. De-duplicate locally first
    // so harmless replays do not masquerade as a cross-proposal collision.
    const uniqueAttempts = new Set(entry.previousAttempts.map(attempt => attempt.attemptId));
    if ([...uniqueAttempts].some(attemptId => attemptIds.has(attemptId))) {
      throw new TypeError("Cross-proposal simulated follow-up attempt ID collision");
    }
    for (const attempt of entry.previousAttempts) {
      // Each proposal assessor has validated timestamp, replay and identity.
      // Exact within-proposal replay remains idempotent; separate proposals
      // making the same recipient-contact claim at one instant are ambiguous.
      const slot = JSON.stringify([entry.intent.recipient, attempt.recordedAt]);
      const existing = recipientAttemptTimes.get(slot);
      if (existing !== undefined && existing !== key) {
        throw new TypeError("Cross-proposal simulated recipient follow-up timestamp collision");
      }
      recipientAttemptTimes.set(slot, key);
    }
    for (const attemptId of uniqueAttempts) attemptIds.add(attemptId);
    observeStops(entry.intent.recipient, entry.events);
    for (const history of historicalStreams?.[seen.size - 1] ?? []) {
      recordRevision(history.intent);
      recordEventIds(history, false);
      observeStops(history.intent.recipient, history.events);
    }
    reviewed.push({recipient: entry.intent.recipient, result,
      attempts: entry.previousAttempts});
    const hold = recipientHolds.get(entry.intent.recipient);
    if (result.category === "contact-suppressed") {
      recipientHolds.set(entry.intent.recipient, "stop-contact");
    } else if (result.category === "reply-needs-review" && !hold) {
      recipientHolds.set(entry.intent.recipient, "reply-review");
    }
  }
  // A stop-contact or reply signal already observed in another proposal for
  // this exact tenant and recipient must not be concealed by a clean-looking
  // case. This changes only redacted counts; it creates no contact authority.
  for (const {recipient, result, attempts} of reviewed) {
    const stoppedAt = earliestStop.get(recipient);
    if (stoppedAt !== undefined && attempts.some(attempt => attempt.recordedAt >= stoppedAt)) {
      throw new TypeError("Cross-proposal simulated follow-up attempt conflicts with contact-stop chronology");
    }
    const hold = recipientHolds.get(recipient);
    const category = hold === "stop-contact" ? "contact-suppressed"
      : hold === "reply-review" ? "reply-needs-review" : result.category;
    const priority = hold === "stop-contact" ? "stop-contact"
      : hold === "reply-review" ? "operator-review" : result.attention;
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (priority === "stop-contact") attention.stopContact++;
    else if (priority === "operator-review") attention.operatorReview++;
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
