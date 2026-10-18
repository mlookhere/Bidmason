// Server-only authenticated account lookup. Never uses a Supabase service key.
import { evidenceProviderSignal } from "./evidence-provider-signal.ts";
export const BIDMASON_SUPABASE_URL = "https://jgbogpunyzkoytrclqdl.supabase.co";
type Http = typeof fetch;
type MemberRole = "owner" | "operator" | "contractor";
type AccountData = { id: string; memberships: { organizationId: string; role: MemberRole }[] };
type Result =
  | { status: 200; data: AccountData }
  | { status: 401 | 502 | 503; error: string };

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ROLES = new Set<MemberRole>(["owner", "operator", "contractor"]);

export async function lookupAccount(
  authorization: string | null,
  publishableKey: string | undefined,
  http: Http = fetch,
  requestSignal?: AbortSignal,
): Promise<Result> {
  // Deliberately disabled without the project-specific public key.
  if (!publishableKey?.startsWith("sb_publishable_")) {
    return { status: 503, error: "Authenticated account access is not configured" };
  }
  if (!authorization || !/^Bearer [A-Za-z0-9._~+/-]+={0,2}$/.test(authorization) || authorization.length > 8192) {
    return { status: 401, error: "Valid bearer authentication is required" };
  }
  if (requestSignal?.aborted) {
    return { status: 502, error: "Account service unavailable" };
  }
  const headers = {
    apikey: publishableKey,
    authorization,
    accept: "application/json",
  };
  try {
    const profile = await http(BIDMASON_SUPABASE_URL + "/auth/v1/user", {
      headers,
      cache: "no-store",
      // Fail before any redirect is followed with the user JWT or API key.
      redirect: "error",
      signal: evidenceProviderSignal(requestSignal, 7_000),
    });
    if (profile.status === 401 || profile.status === 403) {
      return { status: 401, error: "Authentication failed" };
    }
    if (!profile.ok) return { status: 502, error: "Authentication service unavailable" };
    const user: unknown = await profile.json();
    if (requestSignal?.aborted) throw new Error("Account lookup cancelled");
    if (!user || typeof user !== "object" || !("id" in user)
      || typeof user.id !== "string" || !UUID.test(user.id)) {
      return { status: 502, error: "Unexpected account response" };
    }
    const url = new URL("/rest/v1/bm_memberships", BIDMASON_SUPABASE_URL);
    url.searchParams.set("select", "organization_id,member_role");
    url.searchParams.set("user_id", "eq." + user.id);
    if (requestSignal?.aborted) throw new Error("Account lookup cancelled");
    const memberships = await http(url, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: evidenceProviderSignal(requestSignal, 7_000),
    });
    if (memberships.status === 401 || memberships.status === 403) {
      return { status: 401, error: "Authorization failed" };
    }
    if (!memberships.ok) return { status: 502, error: "Account memberships unavailable" };
    const records: unknown = await memberships.json();
    if (requestSignal?.aborted) throw new Error("Account lookup cancelled");
    if (!Array.isArray(records) || records.length > 100) {
      return { status: 502, error: "Unexpected membership response" };
    }
    const parsed: AccountData["memberships"] = [];
    for (const item of records) {
      if (!item || typeof item !== "object"
        || !("organization_id" in item) || !("member_role" in item)
        || typeof item.organization_id !== "string"
        || !UUID.test(item.organization_id)
        || typeof item.member_role !== "string"
        || !ROLES.has(item.member_role as MemberRole)) {
        return { status: 502, error: "Unexpected membership response" };
      }
      parsed.push({ organizationId: item.organization_id, role: item.member_role as MemberRole });
    }
    return { status: 200, data: { id: user.id, memberships: parsed } };
  } catch {
    // Never return provider responses or tokens in error bodies or server logs.
    return { status: 502, error: "Account service unavailable" };
  }
}
