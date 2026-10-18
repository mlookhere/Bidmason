# Private evidence download — authorization at request time

**Status:** implemented on the draft work branch, intentionally **disabled** by default. Not a customer-ready feature and not validated with two genuine Auth/Storage sessions.

The private evidence download helper in `lib/private-evidence-download.ts` and `GET /api/evidence` use **authenticated Supabase Storage**, not a publicly shareable signed URL.

1. Require a valid Supabase Auth bearer token and organization membership (from current Auth and RLS-filtered `bm_memberships`).
2. Validate one lowercase organization UUID and a UUID-named PDF/PNG/JPEG object within that exact tenant. No caller-supplied Storage origin, bucket, receipt digest or privileged key is accepted.
3. Read the metadata through RLS from `bm_evidence_receipts` using the **same JWT**. Refuse missing, cross-tenant or invalid receipts.
4. Read the private Storage object with that JWT. The existing bounded reader enforces the recorded maximum byte length. Verify its SHA-256 against the server-stored receipt before returning anything.
5. Reauthenticate and reread membership **after** the download to avoid returning bytes when membership was revoked mid-request. Send a no-store, attachment-only response with safe content type and no internal metadata.
6. Route remains disabled unless the trusted server has `BIDMASON_PRIVATE_DOWNLOAD_ENABLED=true` and `SUPABASE_PUBLISHABLE_KEY`. This is a deployment switch, **not** proof of operational readiness or permission to enable it before live security testing.

Supabase's documentation states that signed Storage URLs remain valid through expiry even when Auth signing keys are rotated or sessions revoked. Do **not** claim immediate revocation of previously issued signed URLs. For materials requiring prompt revocation, use authenticated private downloads; do not issue signed URLs for this evidence flow.

Tests: `tests-web/private-evidence-download.test.mjs` checks Auth → membership → receipt → Storage → membership order; rejects foreign memberships, forged paths, missing receipt, bad metadata, same-size altered bytes, truncation and mid-download membership revocation.

**Remaining before activation:** two genuine signed-in test accounts and organization assignments on the designated BidMason project; verify real RLS and Storage read behavior for owner/operator and uploader/non-uploader; validate actual session revocation limits, managed rate limits/abuse controls, private key deployment and operations monitoring. Uploading remains disabled until separate malware/file-processing, orphan cleanup, size/rate-limit and Auth tests pass. Avoid testing with real customer documents.

Relevant vendor documentation: https://supabase.com/docs/guides/storage/serving/downloads and https://supabase.com/docs/guides/storage/buckets/fundamentals

## Redirect-denial invariant

Server-side Supabase Auth user checks, RLS membership lookups, and private Storage download transport now use `redirect: "error"`. The private receipt request and privileged quota/receipt providers already use this policy. Provider redirects cannot be silently followed with the user's `Authorization` or API-key header. This remains an internal, disabled-by-default download service; live session and revocation verification are still pending.

## Private Storage body boundedness (2026-10-18)

`lib/bounded-private-storage.ts` now reads provider bodies into a single receipt-sized fixed buffer (1–15 MiB) and enforces a 25-second whole-stream deadline, rather than storing unbounded numbers of fragment arrays or waiting forever for a missing EOF. Incomplete, oversized, nonbinary or never-ending streams fail closed. Cancellation of a hostile provider's stream is attempted but never awaited indefinitely. HTTP Content-Length may reject a download early but cannot expand the receipt budget. Offline tests include 8,192 one-byte fragments, abandoned bodies, hostile cancellation hooks and mutation-safe copy semantics. **This does not establish genuine two-user Supabase Storage/Session proof or enable the private HTTP endpoint.**

## Bounded receipt metadata and request cancellation (2026-10-18)

The disabled-by-default private evidence GET now propagates the incoming `Request.signal` into user Auth, membership, receipt metadata and Storage readback. A client disconnect returns a fail-closed 408 and never delivers verified bytes. Receipt PostgREST JSON is read through `readBoundedProviderJson()`: a fixed-size **8 KiB** buffer, **10-second** whole-body deadline, cancellation-aware streams, exact content-length prechecks, and strict single-receipt validation (query limit two detects duplicate records). This also replaces the local bounded reader in the internal ambiguous-commit diagnostic so both use one bounded reader implementation. Tests check missing/invalid/truncated/duplicate/oversize receipt metadata and aborts during Auth and JSON body read. Customer downloads remain **disabled by default**, regardless of this hardening, until real signed-in provider API and release controls are validated.

## Auth and membership provider JSON boundedness (2026-10-18)

User authentication and member lookup previously called `Response.json()` on unrestricted provider bodies, allowing a slow or oversized response to keep server-side evidence access preflight waiting indefinitely or consuming excessive memory. Both now share the same `readBoundedProviderJson()` stream reader with **separate explicit limits**: 64 KiB for Supabase Auth user metadata and 32 KiB for up to 100 tenant memberships, each with a fixed 7-second complete-body deadline and immediate fail-closed request-abort behavior. Both reject malformed or exaggerated `Content-Length`; the existing membership cap of 100 items and strict identity/role validation remain. The shared reader's maximum is 64 KiB, but evidence receipt metadata remains **8 KiB** and receipt-commit reconciliation keeps its original **8-KiB/7-second** limits. Tests cover large real body, exaggerated Content-Length, malformed JSON, normal multi-membership sets and deliberately stalled/aborted provider streams. These are offline tests, **not** proof of genuine Supabase authenticated API access or authorization to enable the disabled download route.

## One provider deadline across headers and body (2026-10-18)

The Supabase Auth profile (7 seconds), membership PostgREST lookup (7 seconds) and private evidence receipt metadata lookup (10 seconds) now pass **the same composed provider AbortSignal** to both the HTTP request and the fixed-buffer streamed-body reader. Previously the HTTP timeout applied to the initial `fetch` and the body reader started a second full deadline, so slow headers could extend a sensitive authorization decision beyond its intended request budget. The internal read-only ambiguous-receipt inspection likewise uses one shared 7-second signal across headers and body. Abort or expiration is fail-closed: it cannot grant membership, return private evidence bytes, or treat an uncertain remote receipt as committed. The per-body limits remain 64 KiB Auth, 32 KiB memberships, and 8 KiB receipt metadata. Tests simulate a stalled body after headers and verify propagation of the exact same provider signal. These are offline/injected-provider tests, not real signed-in Supabase HTTP approval.
