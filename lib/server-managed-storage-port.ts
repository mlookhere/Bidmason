import { createHash } from "node:crypto";
import type { EvidenceIngestionPort, EvidenceReceipt } from "./evidence.ts";
import { createSupabaseEvidencePort } from "./supabase-evidence-port.ts";
import { readBoundedPrivateStorage } from "./bounded-private-storage.ts";
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";

/**
 * Server-only Storage transport. NOT exposed by an HTTP route.
 * Do not use unless the calling service has enforced Auth, atomic quota and
 * mandatory malware scanning. Service uploads have no user's owner_id.
 */
const BASE = "https://jgbogpunyzkoytrclqdl.supabase.co/storage/v1/object/";
const MAX = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;
const TYPES: Record<string, string> = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" };
export type ManagedStorageConfig = {
  accessToken: string;
  publishableKey: string;
  secretKey: string;
  issueTrustedReceipt: (receipt: EvidenceReceipt) => Promise<void>;
  http?: typeof fetch;
  signal?: AbortSignal;
};

function checkedPath(receipt: EvidenceReceipt, bytes?: Uint8Array): string {
  if (!receipt || !UUID.test(receipt.organization_id) ||
      !PATH.test(receipt.object_path) ||
      receipt.object_path.split("/")[0] !== receipt.organization_id ||
      !TYPES[receipt.content_type] ||
      !receipt.object_path.endsWith(TYPES[receipt.content_type]) ||
      !Number.isSafeInteger(receipt.byte_length) ||
      receipt.byte_length < 1 || receipt.byte_length > MAX ||
      !/^[0-9a-f]{64}$/.test(receipt.content_sha256)) {
    throw new TypeError("Invalid tenant-scoped evidence receipt");
  }
  if (bytes !== undefined &&
      (!(bytes instanceof Uint8Array) || bytes.byteLength !== receipt.byte_length ||
       createHash("sha256").update(bytes).digest("hex") !== receipt.content_sha256)) {
    throw new TypeError("Evidence bytes do not match trusted receipt");
  }
  return receipt.object_path;
}

export function createServerManagedStoragePort(
  config: ManagedStorageConfig,
): EvidenceIngestionPort {
  if (!config?.secretKey?.startsWith("sb_secret_") ||
      !config.publishableKey?.startsWith("sb_publishable_") ||
      typeof config.issueTrustedReceipt !== "function") {
    throw new TypeError("Server-managed Storage configuration unavailable");
  }
  // Preserve genuine caller's JWT for live user + tenant authorization ONLY.
  const scoped = createSupabaseEvidencePort({
    accessToken: config.accessToken,
    publishableKey: config.publishableKey,
    issueTrustedReceipt: config.issueTrustedReceipt,
    http: config.http,
    signal: config.signal,
  });
  const http = config.http ?? fetch;
  async function admin(
    path: string, init: RequestInit,
  ): Promise<{ result: Response; providerSignal: AbortSignal }> {
    if (config.signal?.aborted) throw new Error("Privileged Storage unavailable");
    let result: Response;
    const providerSignal = evidenceProviderSignal(config.signal, 30_000);
    try {
      result = await http(BASE + path, {
        method: init.method,
        body: init.body,
        // Modern sb_secret_ keys are opaque API keys, not JWTs. This request
        // must never carry a signed-in caller's Authorization header.
        headers: { ...init.headers, apikey: config.secretKey },
        cache: "no-store",
        redirect: "error",
        signal: providerSignal,
      });
    } catch {
      throw new Error("Privileged Storage unavailable");
    }
    if (providerSignal.aborted) throw new Error("Privileged Storage unavailable");
    if (!result.ok) throw new Error("Privileged Storage rejected operation");
    return { result, providerSignal };
  }
  return {
    authorize: scoped.authorize,
    async uploadPrivate(userId, receipt, bytes) {
      if (!UUID.test(userId)) throw new TypeError("Invalid authenticated uploader");
      const path = checkedPath(receipt, bytes);
      await admin("bm-evidence/" + path, {
        method: "POST",
        headers: { "Content-Type": receipt.content_type, "x-upsert": "false" },
        body: new Blob([Uint8Array.from(bytes)], { type: receipt.content_type }),
      });
    },
    async readBackPrivate(userId, receipt) {
      if (!UUID.test(userId)) throw new TypeError("Invalid authenticated reader");
      const path = checkedPath(receipt);
      const { result: response, providerSignal } = await admin(
        "authenticated/bm-evidence/" + path, { method: "GET" },
      );
      const length = response.headers.get("content-length");
      if (length !== null && (
        !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) ||
        Number(length) > receipt.byte_length
      )) {
        try { void response.body?.cancel().catch(() => {}); } catch { /* fail closed */ }
        throw new Error("Private evidence exceeds expected size");
      }
      const bytes = await readBoundedPrivateStorage(
        response.body, receipt.byte_length, 25_000, providerSignal,
      );
      if (providerSignal.aborted) throw new Error("Privileged Storage unavailable");
      return bytes;
    },
    issueTrustedReceipt: config.issueTrustedReceipt,
  };
}
