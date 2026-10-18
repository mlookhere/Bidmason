import type { EvidenceReceipt } from "./evidence";
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";

/**
 * Privileged receiver for records that have ALREADY passed
 * ingestVerifiedEvidence()'s authenticated private-Storage readback.
 *
 * This module must only run in the trusted server environment. Never expose
 * its API key or function to a browser, edge-client bundle or public route.
 */
const BASE_URL = "https://jgbogpunyzkoytrclqdl.supabase.co";
const RECEIPTS_ENDPOINT = BASE_URL + "/rest/v1/bm_evidence_receipts";
const MAX_BYTES = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.(pdf|png|jpg)$/;
const MIME_EXTENSION = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
} as const;

export type TrustedReceiptWriterConfig = {
  /** Kept in server-only environment; never read from an HTTP request. */
  secretKey: string;
  /** Bind one backend operation to one pre-authorized organization. */
  organizationId: string;
  http?: typeof fetch;
  /** Trusted server-side request cancellation; does not guarantee rollback. */
  signal?: AbortSignal;
};

function assertReceipt(receipt: EvidenceReceipt, organizationId: string): void {
  if (!receipt || !UUID.test(organizationId) || receipt.organization_id !== organizationId
    || !DIGEST.test(receipt.content_sha256)
    || !Number.isSafeInteger(receipt.byte_length)
    || receipt.byte_length < 1 || receipt.byte_length > MAX_BYTES) {
    throw new TypeError("Invalid or unauthorized evidence receipt metadata");
  }
  const match = PATH.exec(receipt.object_path);
  if (!match || match[1] !== organizationId
    || MIME_EXTENSION[receipt.content_type] !== match[3]) {
    throw new TypeError("Invalid or unauthorized evidence object path");
  }
}

/**
 * Strictly inserts immutable receipt metadata. Does not create storage
 * objects, check membership, or attest identity on its own. The caller
 * must be the trusted ingestion workflow after both authorization checks
 * and an exact private-object readback comparison.
 */
export function createTrustedReceiptWriter(
  config: TrustedReceiptWriterConfig,
): (receipt: EvidenceReceipt) => Promise<void> {
  if (!config.secretKey?.startsWith("sb_secret_")
    || !UUID.test(config.organizationId)) {
    throw new TypeError("Privileged receipt writer is not configured");
  }
  const secretKey = config.secretKey;
  const organizationId = config.organizationId;
  const http = config.http ?? fetch;
  return async (receipt: EvidenceReceipt) => {
    assertReceipt(receipt, organizationId);
    if (config.signal?.aborted) {
      throw new Error("Trusted evidence receipt service unavailable");
    }
    // Strict allowlist of insertable fields. No caller-provided ID, review
    // decision, audit timestamp, conflict resolution or organization switch.
    const record = {
      organization_id: receipt.organization_id,
      object_path: receipt.object_path,
      content_sha256: receipt.content_sha256,
      byte_length: receipt.byte_length,
      content_type: receipt.content_type,
    };
    let response: Response;
    try {
      response = await http(RECEIPTS_ENDPOINT, {
        method: "POST",
        headers: {
          apikey: secretKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(record),
        redirect: "error",
        cache: "no-store",
        signal: evidenceProviderSignal(config.signal, 10_000),
      });
    } catch {
      // Do not forward provider response bodies/headers or privileged keys.
      throw new Error("Trusted evidence receipt service unavailable");
    }
    // Cancellation cannot guarantee a remote DB write was rolled back.
    if (config.signal?.aborted) {
      throw new Error("Trusted evidence receipt service unavailable");
    }
    // Reject duplicate conflicts and every unexpected status. Never upsert.
    if (response.status !== 201) {
      throw new Error("Trusted evidence receipt insertion rejected");
    }
  };
}
