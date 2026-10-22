import {summarizeSyntheticDeliveryReview, type SimulatedReviewSummary,
  type SyntheticReviewEntry} from "./delivery-review-summary.ts";
import {projectSimulatedDeliveryEvents, type DeliveryProjection}
  from "./delivery-event-projection.ts";
import {projectSyntheticDealOutcome, type SyntheticDealOutcomeEvent}
  from "./synthetic-deal-outcome.ts";
import type {SyntheticRecipientHistory} from "./recipient-suppression-history.ts";

/** Redacted FICTIONAL CRM funnel. Counts are neither verified revenue nor
 * buyer contact clearance. Reuses the global review validator so conflicting
 * immutable revisions, cross-proposal event replays and stop-contact races
 * cannot be hidden by aggregation. No persistence, web route or dispatch. */
export type SyntheticCrmPipeline = {
  state: "crm-simulation-only";
  reviewedCases: number;
  distinctProposals: number;
  delivery: {
    notStarted: number;
    reserved: number;
    accepted: number;
    reportedDelivered: number;
    bounced: number;
  };
  deals: {unverified: number; won: number; lost: number};
  attention: SimulatedReviewSummary["attention"];
  contactAuthorized: false;
  dataComplete: false;
};

const DELIVERY = ["not_started", "reserved", "accepted", "reported_delivered",
  "bounced"] as const;
type DeliveryState = DeliveryProjection["delivery"];

/** Every case must supply an explicit deal-outcome array; an empty array
 * means no fictional terminal event was supplied, NOT a genuinely open deal.
 * Aggregation is proposal-scoped for outcomes and case-scoped for delivery.
 * Same-proposal recipients do not inflate fictional won/lost deal totals. */
export function summarizeSyntheticCrmPipeline(
  organizationId: string,
  entries: readonly SyntheticReviewEntry[],
  nowUtc: string,
  dealOutcomes: readonly (readonly SyntheticDealOutcomeEvent[])[],
  history?: readonly (readonly SyntheticRecipientHistory[])[],
): SyntheticCrmPipeline {
  if (!Array.isArray(dealOutcomes)
    || Object.getPrototypeOf(dealOutcomes) !== Array.prototype
    || !Array.isArray(entries)
    || dealOutcomes.length !== entries.length
    || Reflect.ownKeys(dealOutcomes).length !== dealOutcomes.length + 1
    || !Array.from({length: dealOutcomes.length}, (_, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(dealOutcomes, String(i));
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    }).every(Boolean)) {
    throw new TypeError("Full synthetic CRM outcome matrix required");
  }
  // Global invariants and per-case validation MUST execute before counting.
  // History, when supplied, must align with every current entry.
  const review = summarizeSyntheticDeliveryReview(
    organizationId, entries, nowUtc, history, dealOutcomes,
  );

  const deliveryCounts = new Map<DeliveryState, number>(
    DELIVERY.map(kind => [kind, 0]),
  );
  const proposalOutcomes = new Map<string, "unverified" | "won" | "lost">();
  for (let i=0; i<entries.length; i++) {
    const entry = entries[i];
    const delivery = projectSimulatedDeliveryEvents(entry.intent, entry.events);
    deliveryCounts.set(delivery.delivery,
      (deliveryCounts.get(delivery.delivery) ?? 0) + 1);
    const deal = projectSyntheticDealOutcome(
      entry.intent, dealOutcomes[i], nowUtc,
    );
    // An outcome may appear on one of several recipients/revisions. Global
    // review enforces no conflicting terminal claim; NEVER turn an absence
    // in another case into proof that a previously closed deal is open.
    const prior = proposalOutcomes.get(entry.intent.proposalId) ?? "unverified";
    proposalOutcomes.set(entry.intent.proposalId,
      deal.outcome === "unverified" ? prior : deal.outcome);
  }
  const outcomes = [...proposalOutcomes.values()];
  return {
    state: "crm-simulation-only",
    reviewedCases: review.reviewedCases,
    distinctProposals: outcomes.length,
    delivery: {
      notStarted: deliveryCounts.get("not_started") ?? 0,
      reserved: deliveryCounts.get("reserved") ?? 0,
      accepted: deliveryCounts.get("accepted") ?? 0,
      reportedDelivered: deliveryCounts.get("reported_delivered") ?? 0,
      bounced: deliveryCounts.get("bounced") ?? 0,
    },
    deals: {
      unverified: outcomes.filter(x => x === "unverified").length,
      won: outcomes.filter(x => x === "won").length,
      lost: outcomes.filter(x => x === "lost").length,
    },
    attention: review.attention,
    contactAuthorized: false,
    dataComplete: false,
  };
}
