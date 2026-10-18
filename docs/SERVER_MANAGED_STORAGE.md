# Server-managed Storage transport — NOT enabled

Following the restrictive Storage INSERT lockdown, the old user-JWT upload fails closed. The new internal-only createServerManagedStoragePort separates credentials:

- The signed-in JWT and publishable key are used only for live Auth and tenant-membership checks, before upload and again before trusted receipt issuance.
- A server-held sb_secret_ key is used as the apikey header ONLY for pinned bm-evidence Storage POST and readback GET; the caller JWT is never forwarded to those privileged requests.
- Exact tenant-scoped object IDs, MIME type, SHA-256, sizes, no-upsert, redirect refusal, bounded streaming and abort deadlines are checked before privileged actions.

**Release blockers:** This transport is now wired into the **internal-only** `processEvidenceUpload()` chain following mandatory Auth, atomic quota and explicit clean malware-scan checks. It is not a customer upload endpoint; there is no enabled POST route. Genuine two-user Auth/Storage tests and deployed production scanner/secret health are still required before activation.

**Server-created object ownership:** A service-key-created Storage object has no signed-in user `owner_id`. The new **deployed** receipt-backed read policy grants a contractor access only if the server-issued same-tenant/path receipt records their verified `uploaded_by` and the user's membership remains active. It also preserves owner/operator review access. This was verified in PostgreSQL policy tests, but not yet against genuine signed-in Supabase Storage API calls; customer access stays disabled. No blanket contractor read or Storage metadata mutation is permitted.

Tests are offline simulations only; no production secret or user document is present. No signed URLs, public HTTP route, automatic deletion or release approval is introduced.

## Internal chain composition checkpoint

The trusted service now selects this server-managed Storage port after `processEvidenceUpload()` has enforced genuine Auth/membership, atomic quota and explicit clean malware-scanner verdict. The public upload API remains absent and the lower-level service is **not** independently exposed. Negative test cases show no server-key Storage request before the preflight+scan succeeds. This is an integration proof with fake provider responses, not live service-key Storage success, official current signatures or contractor owner/read RLS approval.

## Receipt-owned contractor authorization (deployed to dedicated test Supabase)

The seventh additive migration adds nullable `uploaded_by` to immutable, server-write-only `bm_evidence_receipts` and extends both the permissive and restrictive private Storage SELECT policies: a current organization contractor may read a server-owned object only when a trusted same-org, same-path receipt names their verified Auth user ID. Legacy NULL-attribution receipts grant no new contractor rights. Other same-tenant contractors, foreign tenants, anonymous users, users with revoked membership and attempts to read unreceipted objects remain denied. The server must fill `uploaded_by` from the verified Auth identity, never from request JSON. PostgreSQL CI exercises direct and replayed migrations with simulated `owner_id = NULL`, shadow-permissive SELECT and revocation. Do not enable customer download until real Supabase Auth/Storage policy API testing verifies this behavior.

**Live application:** Managed migration `20261018104109 bidmason_evidence_uploader_read_access` was applied to the dedicated Supabase project `jgbogpunyzkoytrclqdl`; live SQL confirmed both permissive/restrictive SELECT policies reference uploader attribution and current membership. The existing restrictive client-INSERT deny policy remained in place, authenticated users still have no receipt INSERT/UPDATE grant and no real customer/test files were written. A two-account signed-in Storage API session with a real receipt-backed object is **not yet verified**.
