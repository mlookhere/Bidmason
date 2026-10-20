import type {DeliveryIntent} from "./outbound-preflight.ts";
import {projectSimulatedDeliveryEvents, type DeliveryEvent,
  type DeliveryProjection} from "./delivery-event-projection.ts";

/** Historical streams must already be limited to the exact target tenant and
 * recipient. Only fictional, caller-supplied streams are supported. */
export type SyntheticRecipientHistory = {
  intent: DeliveryIntent;
  events: readonly DeliveryEvent[];
};

export type SyntheticRecipientContactReview = {
  state: "review-simulation-only";
  contact: "suppressed-in-fixtures" | "no-suppression-seen-in-fixtures";
  suppression: DeliveryProjection["suppression"];
  repliedInHistory: boolean;
  examinedStreams: number;
  contactAuthorized: false;
};

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function exact(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}
function validHistory(value: unknown): value is SyntheticRecipientHistory[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 30 || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return Array.from({length: value.length}, (_,i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  }).every(Boolean);
}
function validAsOf(value: unknown): value is string {
  if (typeof value !== "string" || !UTC.test(value)) return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

/** Treat bounce, complaint and opt-out as sticky across different proposal
 * identities for the same fictional tenant/recipient. Never treats a lack of
 * evidence as permission; there is NO real send guard, persistence, database,
 * provider, or independent recipient identity/consent authentication here. */
export function reviewSimulatedRecipientContactHistory(
  target: DeliveryIntent,
  history: readonly SyntheticRecipientHistory[],
  asOfUtc: string,
): SyntheticRecipientContactReview {
  if (!validHistory(history) || !validAsOf(asOfUtc)) {
    throw new TypeError("Invalid synthetic recipient history");
  }
  // Validate target identity even when history is empty. No silent success.
  projectSimulatedDeliveryEvents(target, []);

  const keys = new Set<string>();
  const eventIds = new Set<string>();
  const suppression = new Set<DeliveryProjection["suppression"][number]>();
  let repliedInHistory = false;
  let totalEvents = 0;

  for (const record of history) {
    if (!exact(record, ["intent", "events"])) {
      throw new TypeError("Invalid synthetic recipient history record");
    }
    const projection = projectSimulatedDeliveryEvents(record.intent, record.events);
    if (record.intent.organizationId !== target.organizationId
      || record.intent.recipient !== target.recipient) {
      throw new TypeError("Cross-tenant or cross-recipient synthetic history");
    }
    if (record.intent.idempotencyKey === target.idempotencyKey
      || keys.has(record.intent.idempotencyKey)) {
      throw new TypeError("Duplicate or current-proposal synthetic history");
    }
    keys.add(record.intent.idempotencyKey);
    totalEvents += record.events.length;
    if (totalEvents > 500) throw new TypeError("Oversized synthetic recipient history");

    // Reject event-ID collisions across DIFFERENT proposal identities;
    // identical replays within one valid stream are already deduplicated.
    const localIds = new Set<string>();
    for (const event of record.events) {
      if (event.observedAt > asOfUtc) {
        throw new TypeError("Future synthetic recipient observation");
      }
      if (!localIds.has(event.eventId) && eventIds.has(event.eventId)) {
        throw new TypeError("Cross-proposal synthetic event ID collision");
      }
      localIds.add(event.eventId);
    }
    for (const eventId of localIds) eventIds.add(eventId);
    for (const reason of projection.suppression) suppression.add(reason);
    if (projection.replied) repliedInHistory = true;
  }

  return {
    state: "review-simulation-only",
    contact: suppression.size ? "suppressed-in-fixtures" : "no-suppression-seen-in-fixtures",
    suppression: [...suppression].sort(),
    repliedInHistory,
    examinedStreams: history.length,
    contactAuthorized: false,
  };
}
