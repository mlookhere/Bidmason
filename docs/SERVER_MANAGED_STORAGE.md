# Server-managed Storage transport — NOT enabled

Following the restrictive Storage INSERT lockdown, the old user-JWT upload fails closed. The new internal-only createServerManagedStoragePort separates credentials:

- The signed-in JWT and publishable key are used only for live Auth and tenant-membership checks, before upload and again before trusted receipt issuance.
- A server-held sb_secret_ key is used as the apikey header ONLY for pinned bm-evidence Storage POST and readback GET; the caller JWT is never forwarded to those privileged requests.
- Exact tenant-scoped object IDs, MIME type, SHA-256, sizes, no-upsert, redirect refusal, bounded streaming and abort deadlines are checked before privileged actions.

**Release blockers:** This transport is not yet wired as a customer upload endpoint. It must be called only from a mandatory scanner and atomic quota gate; the existing internal processEvidenceUpload path currently calls the prior user-JWT Storage adapter. Until composition is completed and verified, do not enable uploads.

**Ownership issue:** Per Supabase Storage ownership docs, objects created via service/secret key will have no end-user owner_id. Current RLS permits owner/operator or object uploader. Therefore contractor read access is NOT automatically preserved by server-managed uploads. A reviewed receipt-backed uploader attribution/read policy and genuine two-user Auth+Storage tests must precede enabling uploads. Do not mutate the Storage metadata schema or grant all contractors blanket access.

Tests are offline simulations only; no production secret or user document is present. No signed URLs, public HTTP route, automatic deletion or release approval is introduced.
