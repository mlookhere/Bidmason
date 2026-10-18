// Internal, server-only atomic quota adapter; no public upload POST route.
import { BIDMASON_SUPABASE_URL } from "./supabase-account.ts";
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ENDPOINT = BIDMASON_SUPABASE_URL + "/rest/v1/rpc/bm_reserve_upload_quota";

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
        signal: evidenceProviderSignal(signal, 7_000),
      });
      if (signal?.aborted) throw new Error("Quota RPC cancelled");
      if (!response.ok) throw new Error("Quota RPC rejected");
      const result: unknown = await response.json();
      if (signal?.aborted) throw new Error("Quota RPC cancelled");
      if (typeof result !== "boolean") throw new Error("Invalid quota RPC result");
      return result;
    } catch {
      // Fail closed; never log or return privileged credentials or provider data.
      throw new Error("Trusted upload quota unavailable");
    }
  };
}
