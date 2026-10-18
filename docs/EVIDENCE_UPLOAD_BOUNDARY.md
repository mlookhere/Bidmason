# Evidence upload HTTP boundary — internal, not production enabled

**Status:** `lib/evidence-upload-boundary.ts` is a tested internal processor. There is **no public POST route**; the server-only quota and ClamAV adapters exist but are not deployed as a customer upload service. Customer-facing uploads remain disabled.

## Contract

`processEvidenceUpload(request, deps)` accepts only a raw PDF, PNG or JPEG body, a canonical `x-bidmason-organization` UUID, an explicit valid `Content-Length` from 1 byte to 15 MiB, and a Supabase Auth bearer token. Multipart, JSON/base64, URL-selected buckets/hosts, caller-supplied user IDs, and client-controlled secret keys are not supported.

1. **Fail closed before I/O:** real server-side `sb_publishable_` and `sb_secret_` keys, a distributed/durable quota callback and an independent malware-scanning callback must all be installed by a trusted server entrypoint. A missing dependency returns 503. A process-local JavaScript counter must not be used as the authoritative rate limit in multi-instance hosting.
2. **Authenticate before receiving file bytes:** reuse `lookupAccount()` against Supabase Auth with the user's JWT, then confirm an RLS-scoped membership in the exact requested tenant. An invalid or cross-tenant token cannot get to scanning or trusted receipt issuance.
3. **Reserve quota before reading:** a deny returns 429; quota-service errors block with 503. In addition to an authenticated per-user/tenant quota, the eventual ingress needs edge-level unauthenticated request-rate and body-size enforcement.
4. **Bound the stream by actual bytes and time:** require Content-Length, refuse unsafe lengths, read only to the declared size, cancel overflowing streams and reject truncation. `readExactEvidenceBytes()` enforces a nonconfigurable 30-second maximum at the production call site, rejects aborted/stalled clients with HTTP 408, and never waits on attacker-controlled cancellation promises. Signature-check PDF/PNG/JPEG magic bytes using `prepareEvidenceReceipt()` from the existing domain module.
5. **Mandatory scanner:** only the exact trusted response `clean` continues. A scan rejection or scanner fault prevents calling Storage. Signature checks are **not** malware checks and a synthetic clean callback is **never** a deployment-ready scanner.
6. **Trusted issuance after verification:** reuse `ingestForSignedInMember()`, which independently authenticates, checks user-scoped private upload/readback integrity, reauthorizes membership and creates a privileged immutable receipt. Provider errors never return success.

## Verification

`tests-web/evidence-upload-boundary.test.mjs` exercises a positive *injected/mocked* path and rejects absent provider dependencies, malformed IDs/MIME/length, unauthorized actors, cross-tenant membership, quota denial/errors, truncated or overflowing bodies, forged PDF headers, scanner rejection/failure and failed downstream receipt insertion. The required CI `web-build` job typechecks the implementation.

**Current evidence:** The quota is installed in the approved Supabase test project and a genuine ClamAV daemon was exercised in separate CI using a temporary test signature. Neither proves a production scanner with maintained definitions, a deployed upload endpoint, real HTTP use of the trusted quota service, two real user sessions, or an end-to-end Storage write. The upload-boundary unit tests remain synthetic; no production deployment is claimed.** Do not enable a POST route until the real services are bound, two test users exercise positive/negative Storage RLS cases, source retention/cleanup and retry/idempotency are decided, and a current security/privacy review explicitly approves the route. Orphan objects can remain if the trusted receipt insert fails, and must be reconciled by an audited privileged cleanup process rather than granting client DELETE permissions. The read-only `GET /api/evidence` remains independently disabled by default.

## Remaining acceptance work for Issue #4

The tenant-scoped atomic quota and local-only ClamAV provider are implemented, and the real engine plus isolated test signature have passed CI. Still required: provision approved synthetic Auth accounts with genuine memberships and hash-verified Storage fixtures; perform actual signed-in upload, cross-tenant denial, same-tenant owner/operator reads and post-revocation tests; deploy and monitor a daemon with official current definitions; verify the real server-held quota key over HTTP; complete edge-level unauthenticated throttling, operator-approved orphan cleanup/retention, retry/idempotency behavior and Supabase advisors. Do not enable a public POST route or merge PR #12 before all release gates are satisfied.

## 2026-10-18 bounded body deadline and cancellation hardening

`lib/bounded-evidence-stream.ts` handles the incoming request body with a **hard 30-second overall read ceiling** (not merely an idle timeout), observed client disconnects, exact streamed lengths and capped per-chunk handling. Aborted/stalled requests fail with 408 and **do not reach scanning or private Storage**. The hard deadline is not read from a header or tenant preference. Upload quota is reserved before body read and conservatively remains consumed if a client stalls. No unauthenticated edge throttling is implemented by this feature. `tests-web/bounded-evidence-stream.test.mjs` covers missing/short/excess body, stuck streams, aborts, exact size without EOF, nonbinary/empty chunks and invalid deadline parameters. All tests are offline simulations, not live customer HTTP traffic.

## 2026-10-18 fragmented-body and scan-time disconnect hardening

The exact body reader now preallocates at most the validated 15 MiB `Content-Length` and writes chunks into one fixed-size array, rather than keeping a new array for every network fragment. A fragmented 8,192-part binary body and post-read input mutation are regression-tested. An already disconnected client, or one whose signal aborts while malware scanning, cannot advance from a clean verdict to trusted evidence ingestion. The scanner may still need independent abort propagation to release its own daemon socket immediately; no production ingress or deployment is enabled by this code.
