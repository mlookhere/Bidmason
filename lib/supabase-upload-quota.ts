// Internal, server-only atomic quota adapter; no public upload POST route.
import { BIDMASON_SUPABASE_URL } from "./supabase-account.ts";
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";
import { readBoundedProviderJson } from "./bounded-provider-json.ts";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ENDPOINT = BIDMASON_SUPABASE_URL + "/rest/v1/rpc/bm_reserve_upload_quota";
// A PostgREST boolean is the literal JSON `true` or `false`, not a JSON object.
const MAX_QUOTA_REPLY_BYTES = 64;
const QUOTA_TIMEOUT_MS = 7_000;

export function createSupabaseUploadPermit(config: {
  secretKey: string;
  http?: typeof fetch;
}): (userId: string, organizationId: string, signal?: AbortSignal) => Promise<boolean> {
  if (!config.secretKey?.startsWith("sb_secret_")) {
    throw new Error("Trusted upload quota is not configured");
  }
  const http = config.http ?? fetch;
  return async (userId, organizationId, signal) => {
    if (!UUID.test(userId) || !UUID.test(organizationId)) {
      throw new TypeError("Invalid upload quota identities");
    }
    if (signal?.aborted) throw new Error("Trusted upload quota unavailable");
    // One total 7-second provider budget covers the initial HTTP response
    // AND all response-body bytes. Injected fetch transports cannot extend it.
    const providerSignal = evidenceProviderSignal(signal, QUOTA_TIMEOUT_MS);
    let response: Response;
    try {
      response = await http(ENDPOINT, {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_organization_id: organizationId,
        }),
        cache: "no-store",
        redirect: "error",
        signal: providerSignal,
      });
      if (providerSignal.aborted) throw new Error("Quota RPC timed out or cancelled");
      if (!response.ok) throw new Error("Quota RPC rejected");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length)
        || !Number.isSafeInteger(Number(length))
        || Number(length) > MAX_QUOTA_REPLY_BYTES)) {
        throw new Error("Invalid quota RPC response length");
      }
      const result: unknown = await readBoundedProviderJson(
        response.body, MAX_QUOTA_REPLY_BYTES, QUOTA_TIMEOUT_MS, providerSignal,
      );
      if (providerSignal.aborted) throw new Error("Quota RPC timed out or cancelled");
      if (typeof result !== "boolean") throw new Error("Invalid quota RPC result");
      return result;
    } catch {
      // Fail closed; never log or return privileged credentials or provider data.
      throw new Error("Trusted upload quota unavailable");
    }
  };
}
