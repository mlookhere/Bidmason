import type {DeliveryIntent} from "./outbound-preflight.ts";
import type {DeliveryEvent} from "./delivery-event-projection.ts";
import type {FollowUpPolicy, FollowUpRecord} from "./follow-up-assessment.ts";
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
): RecipientAwareDeliveryTriage {
  // Evaluate current events even if historical suppression exists: bad,
  // forged or cross-tenant current evidence must fail rather than hide.
  const current = classifySimulatedDeliveryTriage(
    intent, events, policy, previousAttempts, nowUtc,
  );
  const prior = reviewSimulatedRecipientContactHistory(intent, history, nowUtc);
  if (prior.suppression.length) {
    return {
      ...current,
      category: "contact-suppressed",
      attention: "stop-contact",
      rationale: "Earlier fictional bounce, complaint or opt-out on this recipient"
        + " overrides current proposal state; stop contact and review suppression.",
      historicalContact: prior.contact,
      historicalSuppression: prior.suppression,
      historicalStreams: prior.examinedStreams,
      contactAuthorized: false,
    };
  }
  return {
    ...current,
    historicalContact: prior.contact,
    historicalSuppression: prior.suppression,
    historicalStreams: prior.examinedStreams,
    contactAuthorized: false,
  };
}
