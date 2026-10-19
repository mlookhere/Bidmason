import type { ActiveSessionVerifier } from "./trusted-typed-note-ledger.ts";

// This module is only a server-side Auth adapter. It is not a browser SDK.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}$/;
const KEY = /^[A-Za-z0-9_.-]{20,4096}$/;
const PROJECT = /^[a-z0-9-]+\.supabase\.co$/;
const DENIED = "Fresh Supabase Auth verification required";

const MAX_AUTH_BYTES = 64 * 1024;

/** One absolute deadline spans BOTH headers and streamed Auth JSON. A
 * misbehaving injected transport cannot turn a late HTTP 200 into success. */
function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(DENIED));
  return new Promise<T>((resolve, reject) => {
    let completed = false;
    const finish = (value: T | Error, failed: boolean) => {
      if (completed) return;
      completed = true;
      signal.removeEventListener("abort", abort);
      if (failed) reject(value);
      else resolve(value as T);
    };
    const abort = () => finish(new Error(DENIED), true);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    work.then(
      value => signal.aborted ? abort() : finish(value, false),
      () => finish(new Error(DENIED), true),
    );
  });
}

/** Content-Length is only a hint. Enforce a cap on ACTUAL streamed,
 * decompressed bytes, and reject invalid UTF-8, JSON, or late responses. */
async function readBoundedAuthJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || signal.aborted) throw new Error(DENIED);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let content = "";
  let complete = false;
  try {
    while (true) {
      const chunk = await beforeDeadline(reader.read(), signal);
      if (signal.aborted) throw new Error(DENIED);
      if (chunk.done) {
        complete = true;
        break;
      }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength === 0) {
        throw new Error(DENIED);
      }
      size += chunk.value.byteLength;
      if (size > MAX_AUTH_BYTES) throw new Error(DENIED);
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
    if (signal.aborted || size === 0) throw new Error(DENIED);
    return JSON.parse(content);
  } finally {
    if (!complete) {
      try { void reader.cancel().catch(() => {}); } catch { /* reject only */ }
    }
    try { reader.releaseLock(); } catch { /* pending read: already rejected */ }
  }
}


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
        const signal = AbortSignal.timeout(timeoutMs);
        const response = await beforeDeadline(fetcher(endpoint, {
          method: "GET",
          headers: {
            apikey: publishableKey,
            Authorization: "Bearer " + session,
            Accept: "application/json",
          },
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          signal,
        }), signal);
        if (signal.aborted) throw new Error(DENIED);
        const contentType = response.headers.get("content-type") ?? "";
        const length = response.headers.get("content-length");
        if (response.status !== 200 || response.redirected
          || !/^application\/json(?:\s*;|$)/i.test(contentType)
          || (length !== null && (!/^[0-9]+$/.test(length)
            || !Number.isSafeInteger(Number(length))
            || Number(length) > MAX_AUTH_BYTES))) {
          throw new Error(DENIED);
        }
        user = await readBoundedAuthJson(response, signal);
        if (signal.aborted) throw new Error(DENIED);
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
