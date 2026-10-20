import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";

export type DeliveryEventKind =
  | "reserved" | "provider_accepted" | "provider_delivered"
  | "provider_bounced" | "recipient_opted_out"
  | "provider_complained" | "recipient_replied";

export type DeliveryEvent = {
  eventId: string;
  organizationId: string;
  idempotencyKey: string;
  recipient: string;
  kind: DeliveryEventKind;
  observedAt: string;
};

export type DeliveryProjection = {
  state: "simulation-only";
  delivery: "not_started" | "reserved" | "accepted" | "reported_delivered" | "bounced";
  suppression: ("bounced" | "opted_out" | "complained")[];
  replied: boolean;
  eventCount: number;
  timeline: {eventId: string; kind: DeliveryEventKind; observedAt: string}[];
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEY = /^dryrun_[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INTENT = ["organizationId","proposalId","revision","sourceSha256",
  "policySha256","contentSha256","qaSha256","recipient","idempotencyKey"];
const FIELDS = ["eventId","organizationId","idempotencyKey","recipient","kind","observedAt"];
const KINDS: readonly DeliveryEventKind[] = ["reserved","provider_accepted",
  "provider_delivered","provider_bounced","recipient_opted_out",
  "provider_complained","recipient_replied"];

function ownData(value: unknown, fields: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => {
    const property = Object.getOwnPropertyDescriptor(value,field);
    return property?.enumerable === true && Object.hasOwn(property,"value");
  });
}

function validArray(value: unknown): value is DeliveryEvent[] {
  return Array.isArray(value)
    && Object.getPrototypeOf(value) === Array.prototype
    && value.length <= 500
    && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({length:value.length},(_,i) => Object.hasOwn(
      Object.getOwnPropertyDescriptor(value,String(i)) ?? {},"value")).every(Boolean);
}

function validEvent(input: unknown): input is DeliveryEvent {
  if (!ownData(input,FIELDS)) return false;
  const e = input as DeliveryEvent;
  return typeof e.eventId === "string" && UUID.test(e.eventId)
    && typeof e.organizationId === "string" && UUID.test(e.organizationId)
    && typeof e.idempotencyKey === "string" && KEY.test(e.idempotencyKey)
    && typeof e.recipient === "string" && e.recipient.length <= 254
    && typeof e.kind === "string" && KINDS.includes(e.kind)
    && typeof e.observedAt === "string" && UTC.test(e.observedAt)
    && !Number.isNaN(Date.parse(e.observedAt))
    && new Date(e.observedAt).toISOString() === e.observedAt;
}

/** Pure, unsigned event projection: never proof of actual provider delivery,
 * authenticated identity, consent, commercial approval or authority to send. */
export function projectSimulatedDeliveryEvents(
  intent: DeliveryIntent, events: readonly DeliveryEvent[],
): DeliveryProjection {
  if (!ownData(intent,INTENT) || !validArray(events)) {
    throw new TypeError("Invalid simulated delivery stream");
  }
  const {idempotencyKey,...identity} = intent;
  if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)
    || deliveryIdempotencyKey(identity) !== idempotencyKey) {
    throw new TypeError("Invalid simulated delivery identity");
  }

  let delivery: DeliveryProjection["delivery"] = "not_started";
  let replied = false;
  const suppression = new Set<DeliveryProjection["suppression"][number]>();
  const seen = new Map<string,string>();
  const timeline: DeliveryProjection["timeline"] = [];
  let lastTimestamp = "";

  for (const event of events) {
    if (!validEvent(event) || event.organizationId !== intent.organizationId
      || event.idempotencyKey !== intent.idempotencyKey
      || event.recipient !== intent.recipient) {
      throw new TypeError("Invalid or cross-tenant delivery event");
    }
    const fingerprint = JSON.stringify(FIELDS.map(field => event[
      field as keyof DeliveryEvent
    ]));
    const previous = seen.get(event.eventId);
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new TypeError("Conflicting delivery event replay");
      continue;
    }
    if (event.observedAt < lastTimestamp) {
      throw new TypeError("Out-of-order delivery events require reconciliation");
    }

    switch(event.kind) {
      case "reserved":
        if (delivery !== "not_started" || suppression.size > 0) {
          throw new TypeError("Suppressed or repeated delivery reservation");
        }
        delivery = "reserved";
        break;
      case "provider_accepted":
        if (delivery !== "reserved") throw new TypeError("Unexpected provider acceptance");
        delivery = "accepted";
        break;
      case "provider_delivered":
        if (delivery !== "accepted") throw new TypeError("Unexpected provider delivery");
        delivery = "reported_delivered";
        break;
      case "provider_bounced":
        if (delivery !== "accepted" && delivery !== "reported_delivered") {
          throw new TypeError("Unexpected provider bounce");
        }
        delivery = "bounced";
        suppression.add("bounced");
        break;
      case "recipient_opted_out":
        suppression.add("opted_out");
        break;
      case "provider_complained":
        if (delivery !== "accepted" && delivery !== "reported_delivered"
          && delivery !== "bounced") {
          throw new TypeError("Unexpected provider complaint");
        }
        suppression.add("complained");
        break;
      case "recipient_replied":
        if (delivery !== "reported_delivered" || replied) {
          throw new TypeError("Unexpected recipient reply");
        }
        replied = true;
        break;
    }
    seen.set(event.eventId,fingerprint);
    lastTimestamp = event.observedAt;
    timeline.push({eventId:event.eventId,kind:event.kind,observedAt:event.observedAt});
  }
  return {
    state:"simulation-only", delivery, suppression:[...suppression].sort(),
    replied, eventCount:seen.size, timeline,
  };
}
