# Internal authenticated evidence ingestion — composed security boundary

`ingestForSignedInMember()` in `lib/trusted-evidence-service.ts` composes the existing modules into **one internal Node/server-only function**. It is **not an API route** and is not enabled for external uploads.

1. Rejects missing publishable/privileged server keys, malformed authorization, invalid organization ID and oversize data before any remote request.
2. Asks Supabase Auth who the user actually is; it does **not** accept a user ID from a caller. Verifies that user has a visible membership in the requested company using the same JWT and tenant RLS.
3. Uses the user-scoped Storage adapter to revalidate membership, create an insert-only object in the private `bm-evidence` bucket, read that object back and recalculate the exact SHA-256/size; rechecks membership after asynchronous upload work.
4. Constructs a tenant-pinned, **server-only privileged receipt writer** to insert only validated metadata after readback. It does not send the user JWT to the privileged insert and never gives the privileged key to a browser.

Tests in `tests-web/trusted-evidence-service.test.mjs` mock HTTP to check end-to-end call ordering, configuration rejection, wrong-organization membership, denied upload, tampered bytes, revoked membership and duplicate receipt denial.

**Safety boundary:** The `sb_secret_` key must be set exclusively in an approved server environment and never be constructed from a user request. No actual key was created or used by these mocks. This function is not connected to the Next.js public app. A public route may be enabled **only after** rate limits, request size caps, real session handling, safe secret deployment, virus/file-content policy, orphan cleanup and two-user end-to-end live API tests (including signed URL and session revocation) are completed. The current project remains customer-upload-disabled.
