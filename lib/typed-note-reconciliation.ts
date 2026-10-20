import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateTypedNoteCreateRequest, verifyTypedNoteSourceRecord,
  type TypedNoteCreateRequest, type TypedNoteSourceRecord }
  from "./tenant-typed-note-source.ts";

/**
 * Read-only proof from an authoritative source-and-idempotency-ledger join.
 * Implement lookupAuthorized on a trusted server. Both the immutable ledger
 * and current record MUST be fetched in one primary/linearizable transaction,
 * under the CURRENT authenticated actor/tenant and create-intake permission.
 * A missing ledger row must never be returned for denied access.
 */
export interface TrustedTypedNoteLedger {
  lookupAuthorized(input: {
    organizationId: string;
    requestId: string;
    session: unknown;
    permission: "create-intake";
  }): Promise<{
    authenticatedActorId: string;
    textSha256: string;
    record: TypedNoteSourceRecord | null;
  } | null>;
}

type Confirmation = {organizationId: string; sourceId: string; revision: 1 | 2 | 3;
  textSha256: string};
export type TypedNoteReconciliation =
  | ({state: "confirmed-unprocessed"} & Confirmation & {revision: 1})
  | ({state: "confirmed-advanced"} & Confirmation & {revision: 2 | 3})
  | {state: "not-found-at-read"; organizationId: string; requestId: string}
  | {state: "changed-during-read"; organizationId: string; requestId: string}
  | {state: "conflict"; organizationId: string; requestId: string};

type Receipt = Awaited<ReturnType<TrustedTypedNoteLedger["lookupAuthorized"]>>;

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Only exact plain data receipts may confirm an idempotent create. */
function exactReceipt(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = ["authenticatedActorId", "textSha256", "record"];
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

function inspect(receipt: Receipt, request: TypedNoteCreateRequest,
  textSha256: string): "absent" | "invalid" | "valid" {
  if (receipt === null) return "absent";
  if (!exactReceipt(receipt) || receipt.textSha256 !== textSha256)
    return "invalid";
  try {
    verifyTypedNoteSourceRecord(receipt.record, request, textSha256,
      receipt.authenticatedActorId);
  } catch {
    // A fake ledger, malformed provenance or modified original is not success.
    return "invalid";
  }
  return "valid";
}

/**
 * Reconcile an indeterminate creation using only the original note request.
 * Never call createAuthorized here. No new ID, retry, extraction, approval,
 * quote, send or billing. Even two absent reads are NOT proof of rollback.
 */
export async function reconcileAuthorizedTypedNote(
  ledger: TrustedTypedNoteLedger,
  session: unknown,
  request: TypedNoteCreateRequest,
): Promise<TypedNoteReconciliation> {
  validateTypedNoteCreateRequest(request);
  // The original request is caller-owned and may mutate after an await.
  // Bind both ledger reads to one immutable text/tenant/idempotency identity.
  const target: TypedNoteCreateRequest = {
    organizationId:request.organizationId,
    requestId:request.requestId,
    text:request.text,
  };
  const selector = {organizationId:target.organizationId, requestId:target.requestId};
  const textSha256 = digest(target.text);
  const read = () => ledger.lookupAuthorized({...selector, session,
    permission:"create-intake" as const});
  // Do not catch authorization, network or storage errors as "not found".
  const first = await read();
  const a = inspect(first, target, textSha256);
  // A second fresh read catches observable late commits, races and revocations.
  const last = await read();
  const b = inspect(last, target, textSha256);
  if (a === "invalid" || b === "invalid") {
    return {state:"conflict",...selector};
  }
  if (!isDeepStrictEqual(first, last) || a !== b) {
    return {state:"changed-during-read",...selector};
  }
  if (a === "absent") {
    // Other in-flight transactions may still commit after both reads.
    return {state:"not-found-at-read",...selector};
  }
  const stored = last!.record!;
  const confirmed = {
    organizationId:target.organizationId, sourceId:stored.sourceId,
    revision:stored.revision as 1 | 2 | 3, textSha256,
  };
  return stored.revision === 1
    ? {...confirmed, revision:1, state:"confirmed-unprocessed"}
    : {...confirmed, revision:stored.revision as 2 | 3, state:"confirmed-advanced"};
}
