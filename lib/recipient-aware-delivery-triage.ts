import type {DeliveryIntent} from "./outbound-preflight.ts";
import type {DeliveryEvent} from "./delivery-event-projection.ts";
import type {FollowUpPolicy, FollowUpRecord} from "./follow-up-assessment.ts";
import type {SyntheticDealOutcomeEvent} from "./synthetic-deal-outcome.ts";
import {classifySimulatedDeliveryTriage, type DeliveryTriage} from "./delivery-triage.ts";
import {
  reviewSimulatedRecipientContactHistory,
  type SyntheticRecipientHistory,
  type SyntheticRecipientContactReview,
} from "./recipient-suppression-history.ts";

/** Fictional-only review. Historical suppression overrides a clean-looking
 * current proposal and cannot create contact authority or a sending action. */
export type RecipientAwareDeliveryTriage = DeliveryTriage & {
  historicalContact: SyntheticRecipientContactReview["contact"];
  historicalSuppression: SyntheticRecipientContactReview["suppression"];
  historicalReplyObserved: boolean;
  historicalStreams: number;
  contactAuthorized: false;
};

/** Validate BOTH current proposal events and all caller-provided earlier
 * proposal streams. Never assume history is complete or independently trusted.
 * This function intentionally refuses to convert clean history into approval. */
export function classifySimulatedRecipientAwareTriage(
  intent: DeliveryIntent,
  events: readonly DeliveryEvent[],
  policy: FollowUpPolicy,
  previousAttempts: readonly FollowUpRecord[],
  history: readonly SyntheticRecipientHistory[],
  nowUtc: string,
  dealEvents: readonly SyntheticDealOutcomeEvent[] = [],
): RecipientAwareDeliveryTriage {
  // Evaluate current events even if historical suppression exists: bad,
  // forged or cross-tenant current evidence must fail rather than hide.
  const current = classifySimulatedDeliveryTriage(
    intent, events, policy, previousAttempts, nowUtc, dealEvents,
  );
  const prior = reviewSimulatedRecipientContactHistory(intent, history, nowUtc);
  // Each evaluator independently validates same-stream exact replays. An ID
  // reused across current and historical proposals is never independent
  // provider evidence, even if its event body happens to look identical.
  // The company-wide CRM also refuses these cross-stream ID collisions.
  const currentIds = new Set(events.map(event => event.eventId));
  for (const stream of history) {
    if (stream.events.some(event => currentIds.has(event.eventId))) {
      throw new TypeError("Cross-proposal simulated recipient event ID collision");
    }
  }
  // The aggregate CRM already rejects a reservation made at or after a
  // recipient's stop in a different proposal. Individual triage must not
  // silently classify the same contradictory evidence as ordinary suppression.
  // Both streams have been validated by the independent evaluators above.
  const stopKinds = new Set([
    "recipient_replied", "recipient_opted_out",
    "provider_bounced", "provider_complained",
  ]);
  const currentReserved = events.find(event => event.kind === "reserved")?.observedAt;
  const currentStops = events.filter(event => stopKinds.has(event.kind))
    .map(event => event.observedAt);
  for (const stream of history) {
    const historicalStops = stream.events.filter(event => stopKinds.has(event.kind))
      .map(event => event.observedAt);
    if (currentReserved !== undefined
      && historicalStops.some(stoppedAt => currentReserved >= stoppedAt)) {
      throw new TypeError("Cross-proposal simulated reservation conflicts with contact-stop chronology");
    }
    // Prior recipient stops also prohibit subsequent reminder attempts.
    // Current-proposal validation already checked these attempts' identity,
    // timestamps, minimum delay and replay before this cross-proposal check.
    if (historicalStops.some(stoppedAt =>
      previousAttempts.some(attempt => attempt.recordedAt >= stoppedAt))) {
      throw new TypeError(
        "Cross-proposal simulated follow-up attempt conflicts with contact-stop chronology",
      );
    }
    if (currentStops.length) {
      const historicalReserved = stream.events.find(event => event.kind === "reserved")?.observedAt;
      if (historicalReserved !== undefined
        && currentStops.some(stoppedAt => historicalReserved >= stoppedAt)) {
        throw new TypeError("Cross-proposal simulated reservation conflicts with contact-stop chronology");
      }
    }
  }
  if (prior.suppression.length) {
    return {
      ...current,
      category: "contact-suppressed",
      attention: "stop-contact",
      rationale: "Earlier fictional bounce, complaint or opt-out on this recipient"
        + " overrides current proposal state; stop contact and review suppression.",
      historicalContact: prior.contact,
      historicalSuppression: prior.suppression,
      historicalReplyObserved: prior.repliedInHistory,
      historicalStreams: prior.examinedStreams,
      contactAuthorized: false,
    };
  }
  // A current permanent stop is stricter than an older reply-review hold.
  // Keep its stop-contact priority while still disclosing validated history;
  // an old reply must never downgrade a current opt-out, bounce or complaint.
  if (current.category === "contact-suppressed") {
    return {
      ...current,
      historicalContact: prior.contact,
      historicalSuppression: prior.suppression,
      historicalReplyObserved: prior.repliedInHistory,
      historicalStreams: prior.examinedStreams,
      contactAuthorized: false,
    };
  }
  if (prior.repliedInHistory) {
    return {
      ...current,
      category: "reply-needs-review",
      attention: "operator-review",
      rationale: "A reply on an earlier fictional proposal for this recipient"
        + " requires manual review before any new follow-up; no contact is authorized.",
      historicalContact: prior.contact,
      historicalSuppression: prior.suppression,
      historicalReplyObserved: true,
      historicalStreams: prior.examinedStreams,
      contactAuthorized: false,
    };
  }
  return {
    ...current,
    historicalContact: prior.contact,
    historicalSuppression: prior.suppression,
    historicalReplyObserved: false,
    historicalStreams: prior.examinedStreams,
    contactAuthorized: false,
  };
}
