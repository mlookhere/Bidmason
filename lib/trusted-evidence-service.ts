import { lookupAccount } from "./supabase-account.ts";
import { ingestVerifiedEvidence } from "./evidence.ts";
import type { EvidenceContentType, EvidenceReceipt } from "./evidence.ts";
import { createServerManagedStoragePort } from "./server-managed-storage-port.ts";
import { createTrustedReceiptWriter } from "./supabase-receipt-writer.ts";

/**
 * Server-only, NOT an HTTP route. Requires genuine Supabase Auth, current
 * membership, a private Storage roundtrip and a separate privileged receipt.
 * Never accept the privileged key or alleged user ID from an untrusted caller.
 */
export type TrustedIngestionConfig = {
  publishableKey: string | undefined;
  secretKey: string | undefined;
  http?: typeof fetch;
  createObjectId?: () => string;
};
export type TrustedIngestionInput = {
  authorization: string | null;
  organizationId: string;
  contentType: EvidenceContentType;
  bytes: Uint8Array;
  /** Trusted Request.signal, used only for cancellation, not authorization. */
  signal?: AbortSignal;
};
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_BYTES = 15 * 1024 * 1024;

export async function ingestForSignedInMember(
  input: TrustedIngestionInput,
  config: TrustedIngestionConfig,
): Promise<EvidenceReceipt> {
  // Validate feature configuration and input *before* contacting any external
  // service. This helper must never read configuration from the request body.
  if (!config.publishableKey?.startsWith("sb_publishable_")
    || !config.secretKey?.startsWith("sb_secret_")) {
    throw new Error("Trusted ingestion is not configured");
  }
  if (!input || !UUID.test(input.organizationId)) {
    throw new TypeError("Invalid evidence organization");
  }
  if (!(input.bytes instanceof Uint8Array)
    || input.bytes.length === 0 || input.bytes.length > MAX_BYTES) {
    throw new RangeError("Invalid evidence payload size");
  }
  if (!input.authorization || !/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(input.authorization)
    || input.authorization.length > 8192) {
    throw new Error("Authenticated member required");
  }
  if (input.signal?.aborted) throw new Error("Evidence ingestion cancelled");
  const account = await lookupAccount(
    input.authorization, config.publishableKey, config.http, input.signal,
  );
  if (input.signal?.aborted) throw new Error("Evidence ingestion cancelled");
  if (account.status !== 200) {
    throw new Error("Authenticated member required");
  }
  if (!account.data.memberships.some(
    member => member.organizationId === input.organizationId,
  )) {
    throw new Error("Organization membership required");
  }

  // This method is INTERNAL ONLY: its caller must have reserved atomic quota
  // and received an explicit clean verdict from the trusted malware scanner.
  // Never expose this function as an independently callable HTTP route.
  // Auth and membership use the real user JWT. Storage insert/readback uses
  // only a private server key, preserving the restrictive direct-insert RLS.
  const issueTrustedReceipt = createTrustedReceiptWriter({
    secretKey: config.secretKey,
    organizationId: input.organizationId,
    http: config.http,
    signal: input.signal,
  });
  const port = createServerManagedStoragePort({
    accessToken: input.authorization.slice("Bearer ".length),
    publishableKey: config.publishableKey,
    secretKey: config.secretKey,
    issueTrustedReceipt,
    http: config.http,
    signal: input.signal,
  });
  return ingestVerifiedEvidence(
    account.data.id, input.organizationId, input.contentType,
    input.bytes, port, config.createObjectId, input.signal,
  );
}
