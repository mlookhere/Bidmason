import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {deliveryIdempotencyKey, type DeliveryIntent} from "./outbound-preflight.ts";

/** HMAC contract for fictional fixtures only, not a real email provider adapter.
 * No external event is trusted, stored, delivered, or authorized by this helper. */
export type SyntheticWebhookReceipt = {eventId: string; bodySha256: string};
export type SyntheticWebhookResult =
  | {state: "fixture-verified-only" | "fixture-duplicate-only";
     eventId: string; kind: string; bodySha256: string}
  | {state: "blocked"; reason: string};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEADER = /^t=([1-9][0-9]{0,9}),v1=([a-f0-9]{64})$/;
const INTENT_FIELDS = ["organizationId", "proposalId", "revision", "sourceSha256",
  "policySha256", "contentSha256", "qaSha256", "recipient", "idempotencyKey"];
const EVENT_FIELDS = ["eventId", "organizationId", "idempotencyKey",
  "recipient", "kind", "observedAt"];
const RECEIPT_FIELDS = ["eventId", "bodySha256"];
const PROVIDER_KINDS = ["provider_accepted", "provider_delivered", "provider_bounced",
  "provider_complained", "recipient_opted_out", "recipient_replied"];

function exact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}
function validIntent(value: unknown): value is DeliveryIntent {
  if (!exact(value, INTENT_FIELDS)) return false;
  const i = value as unknown as DeliveryIntent;
  if (typeof i.idempotencyKey !== "string") return false;
  try {
    const {idempotencyKey, ...revisionAndRecipient} = i;
    return deliveryIdempotencyKey(revisionAndRecipient) === idempotencyKey;
  } catch {
    return false;
  }
}
function validLedger(value: unknown): value is SyntheticWebhookReceipt[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > 500 || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const seen = new Map<string, string>();
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item?.enumerable || !Object.hasOwn(item, "value")
        || !exact(item.value, RECEIPT_FIELDS)) return false;
    const receipt = item.value;
    if (typeof receipt.eventId !== "string" || !UUID.test(receipt.eventId)
        || typeof receipt.bodySha256 !== "string" || !SHA.test(receipt.bodySha256)) return false;
    // The whole in-memory fixture must be internally consistent. A conflict
    // on a different event ID is still unsafe evidence for reconciliation.
    const previous = seen.get(receipt.eventId);
    if (previous !== undefined && previous !== receipt.bodySha256) return false;
    seen.set(receipt.eventId, receipt.bodySha256);
  }
  return true;
}

/** Verify a fictional raw-body HMAC fixture. No provider SDK, route, database,
 * webhook response, or send path. External provider signatures differ. */
export function verifySyntheticWebhookFixture(
  rawBody: Buffer, signatureHeader: string, nowSeconds: number, secret: Buffer,
  intent: DeliveryIntent, processed: readonly SyntheticWebhookReceipt[],
): SyntheticWebhookResult {
  if (!Buffer.isBuffer(rawBody) || rawBody.length < 20 || rawBody.length > 4096
      || !Buffer.isBuffer(secret) || secret.length < 32 || secret.length > 128
      || !Number.isSafeInteger(nowSeconds) || nowSeconds < 1 || nowSeconds > 8_640_000_000
      || !validIntent(intent) || !validLedger(processed)) {
    throw new TypeError("Invalid synthetic webhook verification context");
  }
  // Consume one copy of the caller-owned bytes for every cryptographic,
  // canonical-JSON and receipt-hash operation. Direct users of this exported
  // verifier must get the same trust boundary as the batch wrapper: mutating
  // rawBody after HMAC checking must never change the parsed event or receipt.
  const signedBody = Buffer.from(rawBody);
  if (typeof signatureHeader !== "string" || signatureHeader.length > 110) {
    return {state: "blocked", reason: "Invalid synthetic signature header"};
  }
  const match = HEADER.exec(signatureHeader);
  if (!match) return {state: "blocked", reason: "Invalid synthetic signature header"};
  const sentAt = Number(match[1]);
  if (!Number.isSafeInteger(sentAt) || Math.abs(nowSeconds - sentAt) > 300) {
    return {state: "blocked", reason: "Stale or future synthetic webhook timestamp"};
  }
  const signature = Buffer.from(match[2], "hex");
  const expected = createHmac("sha256", secret)
    .update("bidmason:synthetic-webhook:v1\n").update(String(sentAt))
    .update("\n").update(signedBody).digest();
  if (!timingSafeEqual(expected, signature)) {
    return {state: "blocked", reason: "Synthetic HMAC mismatch"};
  }
  let event: unknown;
  try {
    const decoded = new TextDecoder("utf-8", {fatal: true}).decode(signedBody);
    event = JSON.parse(decoded);
    // Reject duplicate keys, noncanonical encoding and unreviewed JSON syntax.
    if (JSON.stringify(event) !== decoded || !exact(event, EVENT_FIELDS)) {
      return {state: "blocked", reason: "Noncanonical synthetic webhook body"};
    }
  } catch {
    return {state: "blocked", reason: "Unreadable synthetic webhook body"};
  }
  const item = event as Record<string, unknown>;
  if (typeof item.eventId !== "string" || !UUID.test(item.eventId)
      || item.organizationId !== intent.organizationId
      || item.idempotencyKey !== intent.idempotencyKey
      || item.recipient !== intent.recipient
      || typeof item.kind !== "string" || !PROVIDER_KINDS.includes(item.kind)
      || typeof item.observedAt !== "string" || !UTC.test(item.observedAt)) {
    return {state: "blocked", reason: "Unscoped or unsupported synthetic event"};
  }
  const observed = Date.parse(item.observedAt);
  // Both the signature timestamp and the signed event time must be fresh
  // relative to actual receipt. Otherwise two separate five-minute tolerances
  // permit a synthetic event almost ten minutes old or in the future.
  // Never truncate the signed event timestamp to whole seconds: otherwise
  // 300.001–300.999-second drift appears to meet a 300-second limit.
  const maxSkewMs = 300_000;
  if (!Number.isFinite(observed) || new Date(observed).toISOString() !== item.observedAt
      || Math.abs(observed - sentAt * 1000) > maxSkewMs
      || Math.abs(observed - nowSeconds * 1000) > maxSkewMs) {
    return {state: "blocked", reason: "Inconsistent synthetic event time"};
  }
  const hash = createHash("sha256").update(signedBody).digest("hex");
  const records = processed.filter(record => record.eventId === item.eventId);
  if (records.some(record => record.bodySha256 !== hash)) {
    return {state: "blocked", reason: "Conflicting synthetic event replay"};
  }
  return {state: records.length ? "fixture-duplicate-only" : "fixture-verified-only",
    eventId: item.eventId, kind: item.kind, bodySha256: hash};
}
