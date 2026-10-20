import type {DeliveryIntent} from "./outbound-preflight.ts";
import type {DeliveryEvent} from "./delivery-event-projection.ts";
import {reconcileSignedSyntheticWebhookBatch,
  type SyntheticSignedEnvelope} from "./synthetic-webhook-batch.ts";
import {SyntheticDispatchReservationLedger} from "./synthetic-dispatch-reservation.ts";

/** Composes two OFFLINE fictional models. HMAC keys and all evidence are
 * supplied by the caller; no real provider is authenticated and no message,
 * customer state, database operation or live authorization is performed. */
export type SyntheticWebhookContactHold = {
  state: "simulation-only";
  decision: "blocked" | "fictional-contact-hold-applied";
  reason: string;
  contactHold: "stop-contact" | "reply-review" | "none";
  reservationVersion: number;
  contactAuthorized: false;
};

export function reconcileSyntheticWebhookContactHold(
  ledger: SyntheticDispatchReservationLedger,
  intent: DeliveryIntent,
  localReservation: DeliveryEvent,
  envelopes: readonly SyntheticSignedEnvelope[],
  secret: Buffer,
  expectedVersion: number,
): SyntheticWebhookContactHold {
  if (!(ledger instanceof SyntheticDispatchReservationLedger)) {
    throw new TypeError("Invalid synthetic webhook contact-hold ledger");
  }
  // Verify every raw-body HMAC, scope, duplicate ID and reconstructed event
  // transition BEFORE attempting any in-memory mutation.
  const result=reconcileSignedSyntheticWebhookBatch(
    intent,localReservation,envelopes,secret);
  const signals={suppression:result.projection.suppression,
    replied:result.projection.replied};
  const applied=ledger.compareAndApplyContactSignals(
    intent,expectedVersion,signals);
  const snapshot=applied.snapshot;
  return {
    state:"simulation-only",
    decision:applied.state==="blocked"?"blocked":"fictional-contact-hold-applied",
    reason:applied.reason,
    contactHold:snapshot.suppression.length?"stop-contact"
      :snapshot.replyReviewRequired?"reply-review":"none",
    reservationVersion:snapshot.version,
    contactAuthorized:false,
  };
}
