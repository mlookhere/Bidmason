import {
  evaluateDeliveryDryRun,
  type DeliveryIntent,
  type ReviewedProposal,
  type InternalReviewReceipt,
  type RecipientSuppression,
  type DispatchHistory,
} from "./outbound-preflight.ts";
import {
  reviewSimulatedRecipientContactHistory,
  type SyntheticRecipientHistory,
} from "./recipient-suppression-history.ts";
import {SyntheticDispatchReservationLedger} from "./synthetic-dispatch-reservation.ts";

/** Only fictional caller-supplied evidence is supported. Never treat the
 * presence of an approved-looking fixture as proof of approval or consent. */
export type SyntheticReservationEvidence = {
  intent: DeliveryIntent;
  proposal: ReviewedProposal;
  receipts: readonly InternalReviewReceipt[];
  suppression: RecipientSuppression;
  dispatch: DispatchHistory;
};

export type SyntheticPreflightReservationResult = {
  state: "blocked" | "reserved-simulation-only";
  reason: "preflight-blocked" | "prior-recipient-suppressed"
    | "prior-recipient-replied" | "synthetic-cas-won-no-send" | "stale-or-invalid-version"
    | "recipient-suppressed" | "recipient-already-reserved";
  blockers: string[];
  observedHistory: "caller-fixtures-only";
  reservationVersion: number;
  contactAuthorized: false;
};

const EVIDENCE_KEYS = ["intent", "proposal", "receipts", "suppression", "dispatch"];
function exactData(value: unknown): value is SyntheticReservationEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== EVIDENCE_KEYS.length) return false;
  return EVIDENCE_KEYS.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

/** A reproducible, NON-SENDING rehearsal of three existing safety boundaries:
 * 1) exact-revision preflight with two distinct fictional reviewers;
 * 2) same-recipient historical opt-out/complaint/bounce and reply review;
 * 3) version-checked in-memory recipient reservation.
 *
 * Every supplied record remains untrusted and synthetic; successful
 * reservation NEVER authorizes a provider call. This is NOT a server route,
 * DB transaction or authenticated authorization decision. */
export function rehearseSyntheticDeliveryReservation(
  ledger: SyntheticDispatchReservationLedger,
  evidence: SyntheticReservationEvidence,
  history: readonly SyntheticRecipientHistory[],
  asOfUtc: string,
  expectedVersion: number,
): SyntheticPreflightReservationResult {
  if (!(ledger instanceof SyntheticDispatchReservationLedger) || !exactData(evidence)) {
    throw new TypeError("Invalid synthetic reservation rehearsal evidence");
  }

  // Validate both sources before deciding or mutating the fictional ledger:
  // an invalid historical record must never be skipped due to an earlier block.
  const preflight = evaluateDeliveryDryRun(
    evidence.intent, evidence.proposal, evidence.receipts,
    evidence.suppression, evidence.dispatch,
  );
  const prior = reviewSimulatedRecipientContactHistory(
    evidence.intent, history, asOfUtc,
  );
  const current = ledger.snapshot(evidence.intent);

  if (preflight.state !== "consistent-internal-only") {
    return {
      state: "blocked", reason: "preflight-blocked",
      blockers: [...preflight.blockers],
      observedHistory: "caller-fixtures-only",
      reservationVersion: current.version,
      contactAuthorized: false,
    };
  }
  if (prior.suppression.length) {
    return {
      state: "blocked", reason: "prior-recipient-suppressed",
      blockers: ["Earlier fictional recipient opt-out, complaint or bounce blocks reservation"],
      observedHistory: "caller-fixtures-only",
      reservationVersion: current.version,
      contactAuthorized: false,
    };
  }

  // An earlier reply is NOT a durable opt-out, but it requires operator
  // review before rehearsing any additional reminder/reservation. Persistent
  // suppression above always has priority over this manual-review hold.
  if (prior.repliedInHistory) {
    return {
      state: "blocked", reason: "prior-recipient-replied",
      blockers: ["Earlier fictional recipient reply requires operator review before another reminder"],
      observedHistory: "caller-fixtures-only",
      reservationVersion: current.version,
      contactAuthorized: false,
    };
  }

  // The CAS checker reads current fictional state again rather than trusting
  // the earlier snapshot. Single-process atomicity is NOT durable safety.
  const result = ledger.compareAndReserve(evidence.intent, expectedVersion);
  return {
    state: result.state === "reserved-simulation-only"
      ? "reserved-simulation-only" : "blocked",
    reason: result.reason as SyntheticPreflightReservationResult["reason"],
    blockers: result.state === "reserved-simulation-only" ? []
      : ["Simulated recipient reservation was rejected"],
    observedHistory: "caller-fixtures-only",
    reservationVersion: result.snapshot.version,
    contactAuthorized: false,
  };
}
