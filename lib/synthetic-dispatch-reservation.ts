import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";
import {projectSyntheticDealOutcome, type SyntheticDealOutcomeEvent}
  from "./synthetic-deal-outcome.ts";

/** Synthetic compare-and-swap state machine: memory only, never a send guard.
 * Do not use this Map in a real web handler, worker, or deployed application. */
type RecordState = {
  version: number;
  reservationKey: string | null;
  reservationProposalId: string | null;
  replyReviewRequired: boolean;
  suppressions: Set<"opted_out" | "bounced" | "complained">;
};

export type SyntheticReservationSnapshot = {
  state: "simulation-only";
  version: number;
  reserved: boolean;
  replyReviewRequired: boolean;
  suppression: ("bounced" | "complained" | "opted_out")[];
  contactAuthorized: false;
};
export type SyntheticReservationVerdict = {
  state: "reserved-simulation-only" | "suppressed-simulation-only"
    | "reply-review-simulation-only" | "blocked";
  reason: string;
  snapshot: SyntheticReservationSnapshot;
};
export type SyntheticDealClosureVerdict = {
  state: "closed-simulation-only" | "blocked";
  reason: "fictional-deal-closure-recorded" | "duplicate-deal-closure";
  invalidatedReservations: number;
  contactAuthorized: false;
};
const INTENT_FIELDS = [
  "organizationId", "proposalId", "revision", "sourceSha256",
  "policySha256", "contentSha256", "qaSha256", "recipient", "idempotencyKey",
];
const REASONS = ["bounced", "complained", "opted_out"] as const;
type SuppressionReason = typeof REASONS[number];

function scopedIntent(value: unknown): DeliveryIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== INTENT_FIELDS.length) {
    throw new TypeError("Invalid synthetic reservation identity");
  }
  for (const field of INTENT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Invalid synthetic reservation identity");
    }
  }
  const intent = value as DeliveryIntent;
  const {idempotencyKey, ...identity} = intent;
  try {
    if (typeof idempotencyKey !== "string"
      || deliveryIdempotencyKey(identity) !== idempotencyKey) {
      throw new TypeError("Invalid synthetic reservation identity");
    }
  } catch {
    throw new TypeError("Invalid synthetic reservation identity");
  }
  return intent;
}
function validVersion(version: unknown): version is number {
  return typeof version === "number" && Number.isSafeInteger(version)
    && version >= 0 && version < Number.MAX_SAFE_INTEGER;
}
const empty = (): RecordState => ({
  version: 0, reservationKey: null, reservationProposalId: null, replyReviewRequired: false,
  suppressions: new Set(),
});

export class SyntheticDispatchReservationLedger {
  #records = new Map<string, RecordState>();
  // Terminal outcomes are proposal-wide, not recipient-scoped. This volatile
  // map intentionally has no reopen/remove action or live event authority.
  #closedProposals = new Map<string, string>();
  // A terminal UUID identifies only one proposal in a given fictional tenant.
  // Checking proposal keys alone misses replayed events against another deal.
  #closureEventOwners = new Map<string, string>();

  #key(intent: DeliveryIntent): string {
    return intent.organizationId + "\u0000" + intent.recipient;
  }
  #proposalKey(intent: DeliveryIntent): string {
    return intent.organizationId + "\u0000" + intent.proposalId;
  }
  #read(intent: DeliveryIntent): RecordState {
    return this.#records.get(this.#key(intent)) ?? empty();
  }
  #snapshot(record: RecordState): SyntheticReservationSnapshot {
    return {
      state: "simulation-only",
      version: record.version,
      reserved: record.reservationKey !== null,
      replyReviewRequired: record.replyReviewRequired,
      suppression: [...record.suppressions].sort(),
      contactAuthorized: false,
    };
  }

  /** An untrusted snapshot is never contact clearance or dispatch authority. */
  snapshot(rawIntent: DeliveryIntent): SyntheticReservationSnapshot {
    const intent = scopedIntent(rawIntent);
    return this.#snapshot(this.#read(intent));
  }

  /** A single synchronous in-memory CAS models one simulated winner.
   * This is NOT durable, distributed, transactional or permission to send. */
  compareAndReserve(rawIntent: DeliveryIntent, expectedVersion: number): SyntheticReservationVerdict {
    const intent = scopedIntent(rawIntent);
    const record = this.#read(intent);
    if (!validVersion(expectedVersion) || record.version !== expectedVersion) {
      return {state: "blocked", reason: "stale-or-invalid-version",
        snapshot: this.#snapshot(record)};
    }
    if (record.suppressions.size) {
      return {state: "blocked", reason: "recipient-suppressed",
        snapshot: this.#snapshot(record)};
    }
    if (record.replyReviewRequired) {
      return {state: "blocked", reason: "recipient-reply-review-required",
        snapshot: this.#snapshot(record)};
    }
    if (this.#closedProposals.has(this.#proposalKey(intent))) {
      return {state: "blocked", reason: "proposal-closed",
        snapshot: this.#snapshot(record)};
    }
    if (record.reservationKey !== null) {
      return {state: "blocked", reason: "recipient-already-reserved",
        snapshot: this.#snapshot(record)};
    }
    const updated: RecordState = {...record, version: record.version + 1,
      reservationKey: intent.idempotencyKey, reservationProposalId: intent.proposalId};
    this.#records.set(this.#key(intent), updated);
    return {state: "reserved-simulation-only", reason: "synthetic-cas-won-no-send",
      snapshot: this.#snapshot(updated)};
  }

  /** An independently observed fictional reply can interrupt an existing
   * in-memory reservation. It is NOT a permanent opt-out, and the model
   * intentionally has no operator-clearance or send transition. */
  compareAndRecordReply(rawIntent: DeliveryIntent, expectedVersion: number): SyntheticReservationVerdict {
    const intent = scopedIntent(rawIntent);
    const record = this.#read(intent);
    if (!validVersion(expectedVersion) || record.version !== expectedVersion) {
      return {state: "blocked", reason: "stale-or-invalid-version",
        snapshot: this.#snapshot(record)};
    }
    if (record.replyReviewRequired) {
      return {state: "blocked", reason: "duplicate-reply-review",
        snapshot: this.#snapshot(record)};
    }
    const updated: RecordState = {
      ...record, version: record.version + 1,
      reservationKey: null, reservationProposalId: null, replyReviewRequired: true,
    };
    this.#records.set(this.#key(intent), updated);
    return {state: updated.suppressions.size
        ? "suppressed-simulation-only" : "reply-review-simulation-only",
      reason: "synthetic-reply-review-recorded", snapshot: this.#snapshot(updated)};
  }

  /** Atomic single-process application of one FULLY VALIDATED fictional
   * contact-state projection. Not an authenticated provider event or DB CAS.
   * Caller-supplied signals are never a production consent decision. */
  compareAndApplyContactSignals(
    rawIntent: DeliveryIntent, expectedVersion: number,
    rawSignals: {suppression: ("bounced" | "complained" | "opted_out")[]; replied: boolean},
  ): SyntheticReservationVerdict {
    const intent = scopedIntent(rawIntent);
    if (!rawSignals || typeof rawSignals !== "object"
      || Array.isArray(rawSignals)
      || Object.getPrototypeOf(rawSignals) !== Object.prototype
      || Reflect.ownKeys(rawSignals).length !== 2
      || !["suppression","replied"].every(field => {
        const descriptor = Object.getOwnPropertyDescriptor(rawSignals, field);
        return descriptor?.enumerable === true && Object.hasOwn(descriptor,"value");
      })) throw new TypeError("Invalid synthetic contact signals");
    const suppression = rawSignals.suppression;
    if (!Array.isArray(suppression)
      || Object.getPrototypeOf(suppression) !== Array.prototype
      || suppression.length > REASONS.length
      || Reflect.ownKeys(suppression).length !== suppression.length + 1) {
      throw new TypeError("Invalid synthetic contact signals");
    }
    // Array iteration reads values BEFORE invoking its callback, which would
    // execute hostile index getters even if the callback checked descriptors.
    // Copy only enumerable own data properties into a validated local list.
    const validated: SuppressionReason[] = [];
    for (let index = 0; index < suppression.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(suppression, String(index));
      if (!entry?.enumerable || !Object.hasOwn(entry,"value")
        || !REASONS.includes(entry.value)) {
        throw new TypeError("Invalid synthetic contact signals");
      }
      validated.push(entry.value);
    }
    if (validated.join(",") !== [...new Set(validated)].sort().join(",")
      || typeof rawSignals.replied !== "boolean") {
      throw new TypeError("Invalid synthetic contact signals");
    }
    const record = this.#read(intent);
    if (!validVersion(expectedVersion) || record.version !== expectedVersion) {
      return {state:"blocked",reason:"stale-or-invalid-version",
        snapshot:this.#snapshot(record)};
    }
    const nextReasons=validated.filter(reason=>!record.suppressions.has(reason));
    const newReply=rawSignals.replied && !record.replyReviewRequired;
    if (!nextReasons.length && !newReply) {
      return {state:"blocked",reason:"duplicate-or-empty-contact-signals",
        snapshot:this.#snapshot(record)};
    }
    const updated: RecordState = {
      version:record.version+1, reservationKey:null, reservationProposalId:null,
      replyReviewRequired:record.replyReviewRequired || rawSignals.replied,
      suppressions:new Set([...record.suppressions,...nextReasons]),
    };
    this.#records.set(this.#key(intent),updated);
    return {
      state:updated.suppressions.size
        ? "suppressed-simulation-only" : "reply-review-simulation-only",
      reason:"synthetic-contact-signals-recorded",
      snapshot:this.#snapshot(updated),
    };
  }

  /** Reconcile a VALIDATED fictional terminal deal decision across EVERY
   * currently reserved recipient in this process, including other revisions.
   * No real CRM source, persistence, provider, send cancellation or distributed
   * transaction is implied. A closure is not a recipient opt-out: other deals
   * may still be considered through their separate fictional preflight. */
  compareAndRecordDealClosure(
    rawIntent: DeliveryIntent,
    events: readonly SyntheticDealOutcomeEvent[],
    asOfUtc: string,
  ): SyntheticDealClosureVerdict {
    const intent = scopedIntent(rawIntent);
    // Validate all caller-supplied closure evidence before touching either map.
    const outcome = projectSyntheticDealOutcome(intent, events, asOfUtc);
    if (outcome.closedAt === null) {
      throw new TypeError("A validated fictional won/lost event is required to close a deal");
    }
    // The projector rejects different terminal events, conflicts, accessors,
    // future timestamps and out-of-scope revisions; identical replays are fine.
    const terminal = events[0];
    const claim = JSON.stringify([
      terminal.eventId, terminal.organizationId, terminal.proposalId,
      terminal.revision, terminal.kind, terminal.observedAt,
    ]);
    const proposalKey = this.#proposalKey(intent);
    const previous = this.#closedProposals.get(proposalKey);
    if (previous !== undefined) {
      if (previous !== claim) {
        throw new TypeError("Conflicting fictional terminal closure for a proposal");
      }
      return {state:"blocked", reason:"duplicate-deal-closure",
        invalidatedReservations:0,contactAuthorized:false};
    }
    const eventKey = intent.organizationId + "\u0000" + terminal.eventId;
    const priorOwner = this.#closureEventOwners.get(eventKey);
    if (priorOwner !== undefined && priorOwner !== proposalKey) {
      throw new TypeError("Conflicting fictional terminal event identity across proposals");
    }
    // Both maps change synchronously only after full validation. A rejected
    // cross-proposal replay cannot close the target or release its reservations.
    this.#closedProposals.set(proposalKey, claim);
    this.#closureEventOwners.set(eventKey, proposalKey);
    let invalidatedReservations = 0;
    const tenantPrefix = intent.organizationId + "\u0000";
    for (const [recipientKey, record] of this.#records) {
      if (!recipientKey.startsWith(tenantPrefix)
        || record.reservationProposalId !== intent.proposalId
        || record.reservationKey === null) continue;
      this.#records.set(recipientKey, {...record, version:record.version+1,
        reservationKey:null, reservationProposalId:null});
      invalidatedReservations++;
    }
    return {state:"closed-simulation-only",reason:"fictional-deal-closure-recorded",
      invalidatedReservations,contactAuthorized:false};
  }

  /** Models suppression racing a reservation. It invalidates any fictional
   * reservation and never offers a lift/unsuppress transition. */
  compareAndSuppress(rawIntent: DeliveryIntent, expectedVersion: number,
    reason: SuppressionReason): SyntheticReservationVerdict {
    const intent = scopedIntent(rawIntent);
    const record = this.#read(intent);
    if (!validVersion(expectedVersion) || record.version !== expectedVersion) {
      return {state: "blocked", reason: "stale-or-invalid-version",
        snapshot: this.#snapshot(record)};
    }
    if (!REASONS.includes(reason)) {
      throw new TypeError("Invalid synthetic suppression reason");
    }
    if (record.suppressions.has(reason)) {
      return {state: "blocked", reason: "duplicate-suppression",
        snapshot: this.#snapshot(record)};
    }
    const updated: RecordState = {
      version: record.version + 1,
      reservationKey: null, reservationProposalId: null,
      replyReviewRequired: record.replyReviewRequired,
      suppressions: new Set([...record.suppressions, reason]),
    };
    this.#records.set(this.#key(intent), updated);
    return {state: "suppressed-simulation-only", reason: "synthetic-suppression-recorded",
      snapshot: this.#snapshot(updated)};
  }
}
