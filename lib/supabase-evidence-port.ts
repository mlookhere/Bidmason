import type { EvidenceIngestionPort, EvidenceReceipt } from "./evidence";
import { readBoundedPrivateStorage } from "./bounded-private-storage.ts";
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";

// Pinned to the only approved BidMason project; no user-supplied host or bucket.
const ORIGIN = "https://jgbogpunyzkoytrclqdl.supabase.co";
const BUCKET = "bm-evidence";
const MAX_BYTES = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const JWT = /^[A-Za-z0-9._~+/-]+={0,2}$/;
const PATH = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.(pdf|png|jpg)$/;

export interface SupabaseEvidenceConfig {
  // Both are server-internal inputs, never returned to an HTTP client.
  accessToken: string;
  publishableKey: string;
  // Privileged insertion is intentionally NOT implemented in this adapter.
  // Its implementation must be server-only, authorized, and never use a
  // browser-supplied key or perform a membership-independent write.
  issueTrustedReceipt: (receipt: EvidenceReceipt) => Promise<void>;
  http?: typeof fetch;
  /** Trusted caller-owned cancellation, never accepted from request JSON. */
  signal?: AbortSignal;
}

function validPath(receipt: EvidenceReceipt): string {
  const match = PATH.exec(receipt.object_path);
  if (!match || match[1] !== receipt.organization_id || !UUID.test(receipt.organization_id)) {
    throw new TypeError("Evidence path is not tenant-scoped");
  }
  const expected = receipt.content_type === "application/pdf" ? "pdf"
    : receipt.content_type === "image/png" ? "png"
    : receipt.content_type === "image/jpeg" ? "jpg" : "";
  if (!expected || expected !== match[3]) {
    throw new TypeError("Evidence extension does not match content type");
  }
  return match[1] + "/" + match[2] + "." + match[3];
}

export function createSupabaseEvidencePort(
  config: SupabaseEvidenceConfig,
): EvidenceIngestionPort {
  if (!config.publishableKey?.startsWith("sb_publishable_")
    || !config.accessToken || config.accessToken.length > 8192
    || !JWT.test(config.accessToken)
    || typeof config.issueTrustedReceipt !== "function") {
    throw new TypeError("Missing or invalid server-only Storage configuration");
  }
  const http = config.http ?? fetch;
  const headers = {
    apikey: config.publishableKey,
    Authorization: "Bearer " + config.accessToken,
  };

  async function response(url: string | URL, init: RequestInit): Promise<Response> {
    if (config.signal?.aborted) throw new Error("Private evidence service unavailable");
    try {
      return await http(url, {
        ...init, headers: { ...headers, ...init.headers },
        cache: "no-store",
        // No bearer/API-key replay to a server-selected redirect target.
        redirect: "error",
        signal: evidenceProviderSignal(config.signal, 30_000),
      });
    } catch {
      throw new Error("Private evidence service unavailable");
    }
  }

  return {
    async authorize(userId: string, organizationId: string): Promise<boolean> {
      if (!UUID.test(userId) || !UUID.test(organizationId)) return false;
      const profile = await response(ORIGIN + "/auth/v1/user", { method: "GET" });
      if (profile.status === 401 || profile.status === 403) return false;
      if (!profile.ok) throw new Error("Auth provider unavailable");
      let account: unknown;
      try { account = await profile.json(); } catch { return false; }
      if (!account || typeof account !== "object" || !("id" in account)
        || account.id !== userId) return false;

      const query = new URL(ORIGIN + "/rest/v1/bm_memberships");
      query.searchParams.set("select", "organization_id");
      query.searchParams.set("user_id", "eq." + userId);
      query.searchParams.set("organization_id", "eq." + organizationId);
      query.searchParams.set("limit", "1");
      const membership = await response(query, { method: "GET" });
      if (membership.status === 401 || membership.status === 403) return false;
      if (!membership.ok) throw new Error("Membership provider unavailable");
      let rows: unknown;
      try { rows = await membership.json(); } catch { return false; }
      return Array.isArray(rows) && rows.length === 1
        && rows[0] !== null && typeof rows[0] === "object"
        && rows[0].organization_id === organizationId;
    },

    async uploadPrivate(userId: string, receipt: EvidenceReceipt, bytes: Uint8Array): Promise<void> {
      if (!UUID.test(userId) || !(bytes instanceof Uint8Array)
        || bytes.length < 1 || bytes.length > MAX_BYTES || bytes.length !== receipt.byte_length) {
        throw new TypeError("Evidence upload size or identity is invalid");
      }
      const path = validPath(receipt);
      const url = ORIGIN + "/storage/v1/object/" + BUCKET + "/" + path;
      // Default INSERT only; never request upsert/overwrite.
      const upload = await response(url, {
        method: "POST",
        headers: { "Content-Type": receipt.content_type, "x-upsert": "false" },
        body: new Blob([Uint8Array.from(bytes)], { type: receipt.content_type }),
      });
      if (config.signal?.aborted) throw new Error("Private evidence service unavailable");
      if (!upload.ok) throw new Error("Private evidence upload rejected");
    },

    async readBackPrivate(userId: string, receipt: EvidenceReceipt): Promise<Uint8Array> {
      if (!UUID.test(userId)) throw new TypeError("Invalid actor");
      const path = validPath(receipt);
      const download = await response(
        ORIGIN + "/storage/v1/object/authenticated/" + BUCKET + "/" + path,
        { method: "GET" },
      );
      if (config.signal?.aborted) throw new Error("Private evidence service unavailable");
      if (!download.ok) throw new Error("Private evidence download rejected");
      // The expected size is known from the bytes we just uploaded. Bound
      // memory to that exact budget, even if Storage omits or lies about
      // Content-Length. Never read an unbounded provider response into RAM.
      if (!Number.isSafeInteger(receipt.byte_length)
        || receipt.byte_length < 1 || receipt.byte_length > MAX_BYTES) {
        throw new TypeError("Invalid expected evidence byte length");
      }
      const limit = receipt.byte_length;
      const advertised = download.headers.get("content-length");
      if (advertised !== null && (
        !/^\d+$/.test(advertised) || !Number.isSafeInteger(Number(advertised))
        || Number(advertised) > limit
      )) {
        try { void download.body?.cancel().catch(() => {}); } catch { /* fail closed */ }
        throw new Error("Private evidence exceeds expected size");
      }
      return readBoundedPrivateStorage(download.body, limit, 25_000, config.signal);
    },

    issueTrustedReceipt: config.issueTrustedReceipt,
  };
}
