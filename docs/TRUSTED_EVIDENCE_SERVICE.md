# Internal authenticated evidence ingestion — composed security boundary

`ingestForSignedInMember()` in `lib/trusted-evidence-service.ts` composes the existing modules into **one internal Node/server-only function**. It is **not an API route** and is not enabled for external uploads.

1. Rejects missing publishable/privileged server keys, malformed authorization, invalid organization ID and oversize data before any remote request.
2. Asks Supabase Auth who the user actually is; it does **not** accept a user ID from a caller. Verifies that user has a visible membership in the requested company using the same JWT and tenant RLS.
3. Uses the user-scoped Storage adapter to revalidate membership, create an insert-only object in the private `bm-evidence` bucket, read that object back and recalculate the exact SHA-256/size; rechecks membership after asynchronous upload work.
4. Constructs a tenant-pinned, **server-only privileged receipt writer** to insert only validated metadata after readback. It does not send the user JWT to the privileged insert and never gives the privileged key to a browser.

Tests in `tests-web/trusted-evidence-service.test.mjs` mock HTTP to check end-to-end call ordering, configuration rejection, wrong-organization membership, denied upload, tampered bytes, revoked membership and duplicate receipt denial.

**Safety boundary:** The `sb_secret_` key must be set exclusively in an approved server environment and never be constructed from a user request. No actual key was created or used by these mocks. This function is not connected to the Next.js public app. A public route may be enabled **only after** rate limits, request size caps, real session handling, safe secret deployment, virus/file-content policy, orphan cleanup and two-user end-to-end live API tests (including signed URL and session revocation) are completed. The current project remains customer-upload-disabled.

## Redirect prevention for bearer-authenticated provider calls

All internal Supabase Auth, RLS membership, and private Storage requests now explicitly pass Fetch `redirect: "error"` (alongside the already-protected trusted quota/receipt requests). A provider HTTP redirect or redirect-follow error fails closed rather than following a new origin with an attached bearer token or API key. Tests check this for every authenticated request across both the member lookup and upload/readback chain, including malicious 302 replies. This is a defensive server transport contract, **not proof of a live authenticated Storage API test or a deployed service**. It creates no public route, user, or secret.

The `tests-web/supabase-network-redirect.test.mjs` regression additionally uses **real local HTTP servers and Node's native Fetch**. A synthetic trusted first hop replies with HTTP 307 to a second loopback server; the real `redirect: "error"` setting prevents the target receiving any request for Auth, user-scoped Storage upload or private download. The original provider endpoints remain fixed to the approved Supabase origin inside the application; only the injected test transport substitutes the initial network hop. No real JWTs or external hosts are contacted.

## Cancellation across privileged ingestion boundaries

The internal HTTP upload processor now propagates its **server-owned** `Request.signal` into the trusted ingestion service and `ingestVerifiedEvidence()`. A client abort is rechecked after the initial Auth/member lookup, the domain's first authorization, private Storage upload, private readback and the final authorization **before issuing the privileged immutable receipt**. The boundary returns 408 for an abort during ingestion, not a misleading 502 or 201. Unit and internal request-integration tests simulate aborts at every individual asynchronous stage and assert that no subsequent Storage action or privileged receipt is attempted. A Storage object may already exist if the client disconnects after upload; this remains eligible only for the separately audited **read-only** orphan review, not silent client DELETE. **This is cooperative cancellation between operations, not complete in-flight network interruption, atomic rollback or full retry idempotency.** The public upload POST remains disabled and genuine multi-user Auth/Storage tests still require approved fixtures.
