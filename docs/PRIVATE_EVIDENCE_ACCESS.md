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
