import type { EvidenceReceipt } from "./evidence.ts";
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";

/**
 * Read-only audit of an ambiguous privileged receipt INSERT.
 *
 * NEVER authorize an upload, a retry, a receipt mutation, or cleanup using
 * this result. A missing row at observation time is NOT proof that a pending
 * write will not later commit. Do not call from an end-user HTTP endpoint.
 */
const BASE = "https://jgbogpunyzkoytrclqdl.supabase.co/rest/v1/bm_evidence_receipts";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;
const MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};
const MAX_RESPONSE_BYTES = 8192;
const READ_DEADLINE_MS = 7_000;

export type ReceiptReconciliationStatus =
  | "matching_committed"
  | "not_observed"
  | "conflict"
  | "unavailable";

export type ReceiptReconciliationResult = {
  status: ReceiptReconciliationStatus;
  /** Advisory only. Never a permission, retry instruction, or success reply. */
  organizationId: string;
  objectPath: string;
};

export type ReceiptReconciliationConfig = {
  secretKey: string;
  /** Server-verified organization, never a client filter. */
  organizationId: string;
  /** Previously authenticated uploader ID, never candidate JSON. */
  uploaderId: string;
  http?: typeof fetch;
  signal?: AbortSignal;
};

function validExpected(receipt: EvidenceReceipt, config: ReceiptReconciliationConfig): boolean {
  if (!receipt || !UUID.test(config.organizationId) || !UUID.test(config.uploaderId)
      || receipt.organization_id !== config.organizationId
      || !PATH.test(receipt.object_path)
      || receipt.object_path.split("/")[0] !== config.organizationId
      || MIME[receipt.content_type] !== PATH.exec(receipt.object_path)?.[2]
      || !Number.isSafeInteger(receipt.byte_length)
      || receipt.byte_length < 1 || receipt.byte_length > 15 * 1024 * 1024
      || !/^[0-9a-f]{64}$/.test(receipt.content_sha256)) {
    return false;
  }
  return true;
}

async function readSmallJsonBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<unknown> {
  if (!body || signal.aborted) throw new Error("No bounded receipt body");
  const reader = body.getReader();
  const bytes = new Uint8Array(MAX_RESPONSE_BYTES);
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let finished = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Receipt read timed out")), READ_DEADLINE_MS);
  });
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Receipt read cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline, cancellation]);
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0
        || value.byteLength > MAX_RESPONSE_BYTES - total) {
        throw new Error("Malformed or oversized receipt response");
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
    if (total === 0 || signal.aborted) throw new Error("Empty or cancelled receipt response");
    finished = true;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)));
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (!finished) {
      try { void reader.cancel().catch(() => {}); } catch { /* do not block */ }
    }
    reader.releaseLock();
  }
}

/** An observational audit, not an automatic recovery operation. */
export async function inspectAmbiguousReceiptCommit(
  expected: EvidenceReceipt,
  config: ReceiptReconciliationConfig,
): Promise<ReceiptReconciliationResult> {
  if (!config?.secretKey?.startsWith("sb_secret_") || !validExpected(expected, config)) {
    throw new TypeError("Invalid trusted receipt reconciliation scope");
  }
  const reference: ReceiptReconciliationResult = {
    status: "unavailable",
    organizationId: config.organizationId,
    objectPath: expected.object_path,
  };
  if (config.signal?.aborted) return reference;

  // Query only the exact canonical tenant/path and select six trusted fields.
  // A limit of two detects duplicate or malformed server responses, not proof
  // of isolation. The privileged key must never be exposed or logged.
  const params = new URLSearchParams({
    select: "organization_id,object_path,content_sha256,byte_length,content_type,uploaded_by",
    organization_id: "eq." + config.organizationId,
    object_path: "eq." + expected.object_path,
    limit: "2",
  });
  try {
    const http = config.http ?? fetch;
    const response = await http(BASE + "?" + params.toString(), {
      method: "GET",
      headers: { apikey: config.secretKey, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: evidenceProviderSignal(config.signal, 7_000),
    });
    if (config.signal?.aborted || response.status !== 200) return reference;
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length)
      || Number(length) > MAX_RESPONSE_BYTES || !Number.isSafeInteger(Number(length)))) {
      return reference;
    }
    const rows = await readSmallJsonBody(response.body, evidenceProviderSignal(config.signal, 7_000));
    if (config.signal?.aborted || !Array.isArray(rows) || rows.length > 1) return reference;
    if (rows.length === 0) return { ...reference, status: "not_observed" };

    const row = rows[0];
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.organization_id !== "string"
      || typeof row.object_path !== "string"
      || typeof row.content_sha256 !== "string"
      || !Number.isSafeInteger(row.byte_length)
      || typeof row.content_type !== "string"
      || typeof row.uploaded_by !== "string") {
      return reference;
    }
    const matches = row.organization_id === expected.organization_id
      && row.object_path === expected.object_path
      && row.content_sha256 === expected.content_sha256
      && row.byte_length === expected.byte_length
      && row.content_type === expected.content_type
      && row.uploaded_by === config.uploaderId;
    return { ...reference, status: matches ? "matching_committed" : "conflict" };
  } catch {
    // Never echo privileged keys, URL/provider response, or uncertain errors.
    return reference;
  }
}
