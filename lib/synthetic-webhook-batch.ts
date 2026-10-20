import type {DeliveryIntent} from "./outbound-preflight.ts";
import {projectSimulatedDeliveryEvents, type DeliveryEvent,
  type DeliveryProjection} from "./delivery-event-projection.ts";
import {verifySyntheticWebhookFixture,
  type SyntheticWebhookReceipt} from "./synthetic-webhook-verification.ts";

/** A fictional envelope. This is NOT a real provider webhook adapter. */
export type SyntheticSignedEnvelope = {
  rawBody: Buffer;
  signatureHeader: string;
  receivedAtSeconds: number;
};

export type SyntheticBatchProjection = {
  state: "simulation-only";
  projection: DeliveryProjection;
  newEvents: number;
  duplicateEvents: number;
};

/** A whole-batch chronological reconstruction, never durable reconciliation. */
export type ReconciledSyntheticBatch = SyntheticBatchProjection & {
  reorderedEvents: number;
};

function exact(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function denseArray(value: unknown): value is SyntheticSignedEnvelope[] {
  return Array.isArray(value)
    && Object.getPrototypeOf(value) === Array.prototype
    && value.length <= 100
    && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({length:value.length}, (_,i) => {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      return d?.enumerable === true && Object.hasOwn(d, "value");
    }).every(Boolean);
}

/** Connect the fictional raw-byte signature verifier with the fictional CRM
 * reducer, rejecting the entire batch on any failed input or invalid order.
 * This function never sends, ingests, persists or authorizes a real event. */
function projectBatch(
  intent: DeliveryIntent,
  localReservation: DeliveryEvent,
  envelopes: readonly SyntheticSignedEnvelope[],
  secret: Buffer,
  reconcile: boolean,
): SyntheticBatchProjection | ReconciledSyntheticBatch {
  if (!denseArray(envelopes)
    || !exact(localReservation, ["eventId", "organizationId",
      "idempotencyKey", "recipient", "kind", "observedAt"])
    || localReservation.kind !== "reserved") {
    throw new TypeError("Invalid synthetic webhook batch");
  }

  // A real provider may never invent a local send reservation. The caller's
  // fictional reservation still must meet the existing exact-tenant reducer.
  projectSimulatedDeliveryEvents(intent, [localReservation]);

  const accepted: DeliveryEvent[] = [localReservation];
  const receipts: SyntheticWebhookReceipt[] = [];
  let duplicateEvents = 0;

  for (const envelope of envelopes) {
    if (!exact(envelope, ["rawBody", "signatureHeader", "receivedAtSeconds"])) {
      throw new TypeError("Invalid synthetic webhook envelope");
    }
    const result = verifySyntheticWebhookFixture(
      envelope.rawBody, envelope.signatureHeader, envelope.receivedAtSeconds,
      secret, intent, receipts,
    );
    if (result.state === "blocked") {
      throw new TypeError("Synthetic webhook batch blocked: " + result.reason);
    }
    if (result.state === "fixture-duplicate-only") {
      duplicateEvents++;
      continue;
    }

    // The strict verifier has already authenticated the fixture HMAC and
    // validated the canonical payload. The reducer validates transitions.
    const event = JSON.parse(envelope.rawBody.toString("utf8")) as DeliveryEvent;
    accepted.push(event);
    receipts.push({eventId: result.eventId, bodySha256: result.bodySha256});
    if (!reconcile) projectSimulatedDeliveryEvents(intent, accepted);
  }

  if (reconcile) {
    // Sort only AFTER every synthetic HMAC and replay ID is checked.
    // Same-time distinct callbacks are ambiguous and must not be guessed.
    const arrival = accepted.slice(1);
    const sorted = [...arrival].sort((a,b) =>
      a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0);
    let last = localReservation.observedAt;
    for (const event of sorted) {
      if (event.observedAt <= last) {
        throw new TypeError("Ambiguous or pre-reservation synthetic webhook chronology");
      }
      last = event.observedAt;
    }
    return {
      state: "simulation-only",
      projection: projectSimulatedDeliveryEvents(intent, [localReservation, ...sorted]),
      newEvents: receipts.length,
      duplicateEvents,
      reorderedEvents: sorted.filter((item,i) => item.eventId !== arrival[i].eventId).length,
    };
  }

  return {
    state: "simulation-only",
    projection: projectSimulatedDeliveryEvents(intent, accepted),
    newEvents: receipts.length,
    duplicateEvents,
  };
}

/** Existing strict arrival-order mode; preserves original fail-closed behavior. */
export function projectSignedSyntheticWebhookBatch(
  intent: DeliveryIntent,
  localReservation: DeliveryEvent,
  envelopes: readonly SyntheticSignedEnvelope[],
  secret: Buffer,
): SyntheticBatchProjection {
  return projectBatch(intent, localReservation, envelopes, secret, false);
}

/** Offline backfill simulation: verify all event signatures before sorting by
 * signed event-time; reject impossible state, collisions and ambiguity.
 * No persistence, webhook intake, race protection or authority to send. */
export function reconcileSignedSyntheticWebhookBatch(
  intent: DeliveryIntent,
  localReservation: DeliveryEvent,
  envelopes: readonly SyntheticSignedEnvelope[],
  secret: Buffer,
): ReconciledSyntheticBatch {
  return projectBatch(intent, localReservation, envelopes, secret, true) as ReconciledSyntheticBatch;
}
