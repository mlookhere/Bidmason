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

/** An intentionally bounded *in-process* stale-version recovery rehearsal.
 * Signature/tenant/event validation is completed exactly once, before any
 * ledger CAS. This cannot survive a crash, prove consent or send anything. */
export type SyntheticWebhookContactRetry = SyntheticWebhookContactHold & {
  staleRechecks: number;
  unresolvedStaleVersion: boolean;
};

/** Rechecks a stale in-memory version at most maxStaleRechecks times.
 * A stale CAS cannot be treated as a delivered/applied contact hold.
 * Existing strict single-attempt API remains unchanged. */
export function reconcileSyntheticWebhookContactHoldWithRetry(
  ledger: SyntheticDispatchReservationLedger,
  intent: DeliveryIntent,
  localReservation: DeliveryEvent,
  envelopes: readonly SyntheticSignedEnvelope[],
  secret: Buffer,
  expectedVersion: number,
  maxStaleRechecks: number,
): SyntheticWebhookContactRetry {
  if (!(ledger instanceof SyntheticDispatchReservationLedger)
    || !Number.isSafeInteger(maxStaleRechecks)
    || maxStaleRechecks < 0 || maxStaleRechecks > 3) {
    throw new TypeError("Invalid synthetic webhook contact-hold retry context");
  }
  // Authenticate the entire FICTIONAL event history and reconcile it BEFORE
  // the first CAS, rather than reusing unverified caller assertions on retry.
  const result=reconcileSignedSyntheticWebhookBatch(
    intent,localReservation,envelopes,secret);
  const signals={suppression:result.projection.suppression,
    replied:result.projection.replied};
  let version=expectedVersion;
  let staleRechecks=0;
  const validInitialVersion=typeof expectedVersion==="number"
    && Number.isSafeInteger(expectedVersion)
    && expectedVersion>=0 && expectedVersion<Number.MAX_SAFE_INTEGER;
  for (;;) {
    const applied=ledger.compareAndApplyContactSignals(intent,version,signals);
    const stale=applied.reason==="stale-or-invalid-version";
    if (!stale || !validInitialVersion || staleRechecks>=maxStaleRechecks) {
      const snapshot=applied.snapshot;
      return {
        state:"simulation-only",
        decision:applied.state==="blocked"?"blocked":"fictional-contact-hold-applied",
        reason:applied.reason,
        contactHold:snapshot.suppression.length?"stop-contact"
          :snapshot.replyReviewRequired?"reply-review":"none",
        reservationVersion:snapshot.version,
        contactAuthorized:false,
        staleRechecks,
        unresolvedStaleVersion:stale,
      };
    }
    staleRechecks++;
    version=applied.snapshot.version;
  }
}
