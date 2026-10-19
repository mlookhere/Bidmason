import type { ActiveSessionVerifier } from "./trusted-typed-note-ledger.ts";

// This module is only a server-side Auth adapter. It is not a browser SDK.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}$/;
const KEY = /^[A-Za-z0-9_.-]{20,4096}$/;
const PROJECT = /^[a-z0-9-]+\.supabase\.co$/;
const DENIED = "Fresh Supabase Auth verification required";

export interface SupabaseAuthVerifierConfig {
  /** Trusted deployment configuration; never supplied by a request body. */
  projectUrl: string;
  /** Modern sb_publishable_ key ONLY; never a secret/service-role key. */
  publishableKey: string;
  /** Test transport injection. Production must use server fetch. */
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Performs a FRESH server-side GET /auth/v1/user for EACH invocation.
 * No JWT payload, getSession result, user_metadata, role claim or cache
 * authorizes access. The database separately enforces current tenant roles.
 *
 * Supabase JWT access-token revocation is not necessarily instantaneous;
 * true strict session revocation still needs a verified session_id lookup
 * against auth.sessions on sensitive production paths.
 */
export function createSupabaseActiveSessionVerifier(
  configuration: SupabaseAuthVerifierConfig,
): ActiveSessionVerifier {
  if (typeof window !== "undefined") {
    throw new Error("Supabase Auth verification must run on the server");
  }
  const { projectUrl, publishableKey, timeoutMs = 8000 } = configuration;
  if (typeof projectUrl !== "string" || typeof publishableKey !== "string"
    || !KEY.test(publishableKey) || !publishableKey.startsWith("sb_publishable_")
    || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) {
    throw new TypeError("Invalid trusted Supabase Auth configuration");
  }
  let base: URL;
  try { base = new URL(projectUrl); }
  catch { throw new TypeError("Invalid trusted Supabase Auth URL"); }
  if (base.protocol !== "https:" || !PROJECT.test(base.hostname)
    || base.username || base.password || base.port || base.search || base.hash
    || base.pathname !== "/" || projectUrl !== base.origin
      && projectUrl !== base.origin + "/") {
    throw new TypeError("Trusted Supabase Auth origin must be a project HTTPS origin");
  }
  const fetcher = configuration.fetcher ?? fetch;
  if (typeof fetcher !== "function") {
    throw new TypeError("No server Auth transport configured");
  }
  const endpoint = base.origin + "/auth/v1/user";
  return {
    async verifyActiveSession(session: unknown): Promise<{ userId: string }> {
      // Accept only a JWT string, not a caller-controlled claimed user object.
      if (typeof session !== "string" || session.length > 16384
        || !JWT.test(session)) {
        throw new Error(DENIED);
      }
      let user: unknown;
      try {
        const response = await fetcher(endpoint, {
          method: "GET",
          headers: {
            apikey: publishableKey,
            Authorization: "Bearer " + session,
            Accept: "application/json",
          },
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.timeout(timeoutMs),
        });
        const contentType = response.headers.get("content-type") ?? "";
        const length = response.headers.get("content-length");
        if (response.status !== 200 || response.redirected
          || !/^application\/json(?:\s*;|$)/i.test(contentType)
          || (length !== null && (!/^[0-9]+$/.test(length)
            || Number(length) > 65536))) {
          throw new Error(DENIED);
        }
        user = await response.json();
      } catch {
        // Never put a bearer token, Auth response or network details in errors.
        throw new Error(DENIED);
      }
      if (!user || typeof user !== "object" || Array.isArray(user)
        || typeof (user as {id?: unknown}).id !== "string"
        || !UUID.test((user as {id:string}).id)
        || (user as {is_anonymous?: unknown}).is_anonymous === true) {
        throw new Error(DENIED);
      }
      return { userId: (user as {id:string}).id };
    },
  };
}
