# Server-managed Storage transport — NOT enabled

Following the restrictive Storage INSERT lockdown, the old user-JWT upload fails closed. The new internal-only createServerManagedStoragePort separates credentials:

- The signed-in JWT and publishable key are used only for live Auth and tenant-membership checks, before upload and again before trusted receipt issuance.
- A server-held sb_secret_ key is used as the apikey header ONLY for pinned bm-evidence Storage POST and readback GET; the caller JWT is never forwarded to those privileged requests.
- Exact tenant-scoped object IDs, MIME type, SHA-256, sizes, no-upsert, redirect refusal, bounded streaming and abort deadlines are checked before privileged actions.

**Release blockers:** This transport is not yet wired as a customer upload endpoint. It must be called only from a mandatory scanner and atomic quota gate; the existing internal processEvidenceUpload path currently calls the prior user-JWT Storage adapter. Until composition is completed and verified, do not enable uploads.

**Ownership issue:** Per Supabase Storage ownership docs, objects created via service/secret key will have no end-user owner_id. Current RLS permits owner/operator or object uploader. Therefore contractor read access is NOT automatically preserved by server-managed uploads. A reviewed receipt-backed uploader attribution/read policy and genuine two-user Auth+Storage tests must precede enabling uploads. Do not mutate the Storage metadata schema or grant all contractors blanket access.

Tests are offline simulations only; no production secret or user document is present. No signed URLs, public HTTP route, automatic deletion or release approval is introduced.

## Internal chain composition checkpoint

The trusted service now selects this server-managed Storage port after `processEvidenceUpload()` has enforced genuine Auth/membership, atomic quota and explicit clean malware-scanner verdict. The public upload API remains absent and the lower-level service is **not** independently exposed. Negative test cases show no server-key Storage request before the preflight+scan succeeds. This is an integration proof with fake provider responses, not live service-key Storage success, official current signatures or contractor owner/read RLS approval.

## Receipt-owned contractor authorization (candidate migration)

The seventh additive migration adds nullable `uploaded_by` to immutable, server-write-only `bm_evidence_receipts` and extends both the permissive and restrictive private Storage SELECT policies: a current organization contractor may read a server-owned object only when a trusted same-org, same-path receipt names their verified Auth user ID. Legacy NULL-attribution receipts grant no new contractor rights. Other same-tenant contractors, foreign tenants, anonymous users, users with revoked membership and attempts to read unreceipted objects remain denied. The server must fill `uploaded_by` from the verified Auth identity, never from request JSON. PostgreSQL CI exercises direct and replayed migrations with simulated `owner_id = NULL`, shadow-permissive SELECT and revocation. Do not enable customer download until real Supabase Auth/Storage policy API testing verifies this behavior.
