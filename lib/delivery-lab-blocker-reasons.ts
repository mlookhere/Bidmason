import type {DeliveryLabCase} from "./delivery-lab-fixtures.ts";

/** Read-only, fictional explanation only. Retain *all* independent reasons:
 * a current-proposal timing/consent hold never masks a previous proposal's
 * recipient-wide reply or suppression. No token, recipient, tenant or real
 * event identity is emitted, and no result is permission to send. */
export function syntheticDeliveryBlockerReasons(
  scenario: Pick<DeliveryLabCase,
    "followUp"|"historicalSuppression"|"triage">,
): string[] {
  const reasons=[...scenario.followUp.blockers];
  if(scenario.historicalSuppression.length){
    reasons.push("Earlier recipient suppression overrides this proposal's internal timing assessment. Contact remains blocked.");
  }
  if(scenario.triage.historicalReplyObserved){
    reasons.push("Earlier recipient reply requires manual review before a new follow-up. Contact remains blocked.");
  }
  if(!reasons.length)
    reasons.push("No internal timing blocker in fixture. External authorization and real consent remain unverified.");
  return [...new Set(reasons)];
}
