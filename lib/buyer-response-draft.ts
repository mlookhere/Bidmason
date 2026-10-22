import {createHash} from "node:crypto";
import {verifyBuyerViewGrant, type BuyerViewIdentity} from "./buyer-view-grant.ts";

/** Nonbinding draft validation only. The grant is for read-only viewing;
 * verification of signed claims is NOT authorization to submit a response. */
export type BuyerResponseDraftInput = BuyerViewIdentity & {
  kind: "question" | "request_changes" | "decline";
  note: string;
};

export type BuyerResponseAssessment =
  | {state: "draft-internal-only"; fingerprint: string; grantId: string; kind: BuyerResponseDraftInput["kind"]}
  | {state: "blocked"; reason: string};

const SHA = /^[0-9a-f]{64}$/;
const GRANT = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIELDS = ["organizationId", "proposalId", "revision",
  "recipientSha256", "contentSha256", "kind", "note"] as const;
const IDENTITY = ["organizationId", "proposalId", "revision",
  "recipientSha256", "contentSha256"] as const;
const KINDS = ["question", "request_changes", "decline"] as const;
// Exclude invisible separators and formatting controls that can conceal
// material text from reviewers. Printable multilingual letters remain valid.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff<>]/u;
// In Unicode-aware regex mode a valid surrogate pair is a single code point;
// this range catches only lone UTF-16 surrogates, which cannot be shown faithfully.
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u;

function ownData(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== fields.length) return false;
  return fields.every(field => {
    const property = Object.getOwnPropertyDescriptor(value, field);
    return property?.enumerable === true && Object.hasOwn(property, "value");
  });
}

function validDraft(value: unknown): value is BuyerResponseDraftInput {
  if (!ownData(value, FIELDS)) return false;
  return typeof value.organizationId === "string" && UUID.test(value.organizationId)
    && typeof value.proposalId === "string" && UUID.test(value.proposalId)
    && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1
    && typeof value.recipientSha256 === "string" && SHA.test(value.recipientSha256)
    && typeof value.contentSha256 === "string" && SHA.test(value.contentSha256)
    && typeof value.kind === "string"
    && KINDS.includes(value.kind as BuyerResponseDraftInput["kind"])
    && typeof value.note === "string" && value.note.length <= 500
    && value.note === value.note.trim() && value.note === value.note.normalize("NFC")
    && !UNSAFE_TEXT.test(value.note) && !UNPAIRED_SURROGATE.test(value.note)
    && (value.kind === "decline" || value.note.length > 0);
}

function validGrantIds(value: unknown): value is string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > 500 || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return Array.from({length: value.length}, (_, i) => {
    const property = Object.getOwnPropertyDescriptor(value, String(i));
    return property?.enumerable === true && Object.hasOwn(property, "value")
      && typeof property.value === "string" && GRANT.test(property.value);
  }).every(Boolean);
}

/** Pure validation of a *fictional*, nonbinding draft. No storage, network,
 * contact, signature on the response, or commercially effective acceptance.
 * The caller MUST separately authenticate the buyer and use durable,
 * transactionally verified grant/response revocation and uniqueness. */
export function assessBuyerResponseDraft(
  input: BuyerResponseDraftInput,
  expected: BuyerViewIdentity,
  viewToken: string,
  signingKey: Uint8Array,
  nowSeconds: number,
  revokedGrantIds: readonly string[],
  previouslyRespondedGrantIds: readonly string[],
): BuyerResponseAssessment {
  if (!validDraft(input) || !validGrantIds(revokedGrantIds)
    || !validGrantIds(previouslyRespondedGrantIds)) {
    throw new TypeError("Invalid nonbinding buyer-response evidence");
  }
  // The verifier validates the expected identity and key before reading claims.
  const verified = verifyBuyerViewGrant(
    viewToken, expected, signingKey, nowSeconds, revokedGrantIds,
  );
  if (verified.state === "blocked") {
    return {state: "blocked", reason: "Read-only view claims do not match the requested revision"};
  }
  if (IDENTITY.some(field => input[field] !== expected[field])) {
    return {state: "blocked", reason: "Buyer response is not bound to the viewed proposal"};
  }
  if (previouslyRespondedGrantIds.includes(verified.grantId)) {
    return {state: "blocked", reason: "This grant already has a response recorded in supplied history"};
  }

  const fingerprint = createHash("sha256").update(JSON.stringify([
    "nonbinding-buyer-response-v1", verified.grantId,
    ...IDENTITY.map(field => input[field]), input.kind, input.note,
  ])).digest("hex");

  return {state: "draft-internal-only", fingerprint,
    grantId: verified.grantId, kind: input.kind};
}
