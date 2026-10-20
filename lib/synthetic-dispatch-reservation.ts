import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";

/** Synthetic compare-and-swap state machine: memory only, never a send guard.
 * Do not use this Map in a real web handler, worker, or deployed application. */
type RecordState = {
  version: number;
  reservationKey: string | null;
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
  version: 0, reservationKey: null, replyReviewRequired: false,
  suppressions: new Set(),
});

export class SyntheticDispatchReservationLedger {
  #records = new Map<string, RecordState>();

  #key(intent: DeliveryIntent): string {
    return intent.organizationId + "\u0000" + intent.recipient;
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
    if (record.reservationKey !== null) {
      return {state: "blocked", reason: "recipient-already-reserved",
        snapshot: this.#snapshot(record)};
    }
    const updated: RecordState = {...record, version: record.version + 1,
      reservationKey: intent.idempotencyKey};
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
      reservationKey: null, replyReviewRequired: true,
    };
    this.#records.set(this.#key(intent), updated);
    return {state: "reply-review-simulation-only", reason: "synthetic-reply-review-recorded",
      snapshot: this.#snapshot(updated)};
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
      reservationKey: null,
      replyReviewRequired: record.replyReviewRequired,
      suppressions: new Set([...record.suppressions, reason]),
    };
    this.#records.set(this.#key(intent), updated);
    return {state: "suppressed-simulation-only", reason: "synthetic-suppression-recorded",
      snapshot: this.#snapshot(updated)};
  }
}
