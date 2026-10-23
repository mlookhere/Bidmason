import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";
import {assessSimulatedFollowUp, type FollowUpPolicy, type FollowUpRecord}
  from "./follow-up-assessment.ts";
import {projectSimulatedDeliveryEvents, type DeliveryEvent}
  from "./delivery-event-projection.ts";
import {projectSyntheticDealOutcome, type SyntheticDealOutcomeEvent}
  from "./synthetic-deal-outcome.ts";

/** Fictional operator-review classification; never a live queue or permission to send. */
export type DeliveryTriage = {
  state: "review-simulation-only";
  category: "contact-suppressed" | "reply-needs-review" | "consent-needs-verification"
    | "delivery-needs-verification" | "waiting-for-cooldown"
    | "deal-closed" | "follow-up-limit-reached" | "external-authorization-required";
  attention: "stop-contact" | "operator-review" | "deferred";
  rationale: string;
  sourceEventCount: number;
};

/** Evaluate current fictional event evidence on every call. Caller-provided
 * data is never real provider/consent evidence, even when internally valid. */
export function classifySimulatedDeliveryTriage(
  intent: DeliveryIntent,
  events: readonly DeliveryEvent[],
  policy: FollowUpPolicy,
  previousAttempts: readonly FollowUpRecord[],
  nowUtc: string,
  dealEvents: readonly SyntheticDealOutcomeEvent[] = [],
): DeliveryTriage {
  // Both existing evaluators enforce exact tenant/revision and chronology.
  const delivery = projectSimulatedDeliveryEvents(intent,events);
  const followUp = assessSimulatedFollowUp(intent,events,policy,previousAttempts,nowUtc,dealEvents);
  const deal = projectSyntheticDealOutcome(intent,dealEvents,nowUtc);
  // A follow-up assessor can surface a future event as a blocker, but the
  // operator-facing triage must not classify unobserved delivery, reply or
  // suppression events as current evidence. Mirror the company-wide CRM's
  // fail-closed as-of boundary, including a millisecond-accurate comparison.
  if (delivery.timeline.some(event => event.observedAt > nowUtc)) {
    throw new TypeError("Future simulated current-proposal triage observation");
  }
  const {idempotencyKey,...identity} = intent;
  if(deliveryIdempotencyKey(identity)!==idempotencyKey)
    throw new TypeError("Invalid simulated triage identity");

  let category: DeliveryTriage["category"];
  let attention: DeliveryTriage["attention"];
  let rationale: string;

  if(delivery.suppression.length){
    category="contact-suppressed";
    attention="stop-contact";
    rationale="Fictional bounce, complaint or opt-out: do not contact; human suppression review required.";
  }else if(policy.consent==="revoked"){
    // Explicitly revoked consent is a known stop, NOT an unknown consent
    // state that can be cleared by ordinary operator verification.
    // Evaluate after stream suppression so provider stop evidence is retained,
    // but before replies/cooldowns/closed deals to preserve the stronger hold.
    category="contact-suppressed";
    attention="stop-contact";
    rationale="Fictional contact consent was revoked: do not contact; independent consent review required.";
  }else if(delivery.replied){
    category="reply-needs-review";
    attention="operator-review";
    rationale="Fictional recipient reply requires manual review; follow-up remains blocked.";
  }else if(deal.closedAt){
    category="deal-closed";
    attention="deferred";
    rationale="Fictional won/lost deal is closed; do not schedule a follow-up.";
  }else if(policy.consent!=="confirmed"){
    category="consent-needs-verification";
    attention="operator-review";
    rationale="Fictional consent is missing or revoked; no recipient contact is authorized.";
  }else if(delivery.delivery!=="reported_delivered"){
    category="delivery-needs-verification";
    attention="operator-review";
    rationale="No complete fictional delivery history; verify external provider evidence.";
  }else if(followUp.recordedAttempts>=policy.maximumAttempts){
    category="follow-up-limit-reached";
    attention="deferred";
    rationale="Fictional reminder attempt cap reached; waiting longer cannot authorize another attempt.";
  }else if(followUp.blockers.some(x=>x.includes("Minimum follow-up delay"))){
    category="waiting-for-cooldown";
    attention="deferred";
    rationale="Fictional minimum follow-up delay has not elapsed; never enqueue a send.";
  }else{
    // Even a fully consistent dry run has NO authenticated provider,
    // current tenant approval, live consent, or atomic dispatch reservation.
    category="external-authorization-required";
    attention="operator-review";
    rationale="Internal checks alone cannot authorize sending; real consent, approvals and dispatch remain unverified.";
  }
  return {state:"review-simulation-only",category,attention,rationale,
    sourceEventCount:delivery.eventCount};
}
