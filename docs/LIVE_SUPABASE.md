# BidMason: live Supabase integration and deployment record

**Only approved project:** `jgbogpunyzkoytrclqdl` (`BidMason`, `mlookhere's Org`, `us-west-1`).
[Supabase dashboard](https://supabase.com/dashboard/project/jgbogpunyzkoytrclqdl).
Do not run BidMason migrations against `Free the music` or `Proofmode`.

## Completed on 2026-10-16

- Project `ACTIVE_HEALTHY`, PostgreSQL **17.11**.
- Managed migration `20261017035109` — `bidmason_tenant_foundation`: applied successfully from `db/schema.sql` and `db/evidence_receipts.sql`.
- Managed migration `20261017035151` — `bidmason_evidence_storage`: applied successfully from `db/storage_policies.sql`.
- Managed migration `20261017035730` — `bidmason_evidence_review_fk_index`: applied successfully from `db/review_indexes.sql` to cover the tenant/evidence-reference foreign key. The Supabase performance advisor's missing-FK-index notice was cleared. Unused-index notices remain informational on this empty database.
- Managed migration `20261017063426` — `bidmason_independent_fact_review`: applied successfully from `db/review_independence.sql`. Owner/operator fact reviewers must have a different authenticated user identity than the fact submitter. Isolated PostgreSQL regression and managed Supabase rollback-only role-simulation tests exercised both a rejected self-review and accepted separate-person review; no synthetic rows remain.
- **7/7 public tenant tables have RLS enabled**, with 11 tenant policies and **2 `security_invoker` views**. The authenticated role cannot insert into privileged receipt table, and `anon` cannot select memberships.
- One **private** `bm-evidence` Storage bucket, 15 MiB max, PDF/PNG/JPEG bucket-level allowlist, and **6 Storage object policies** including restrictive tenant boundaries and update/delete denial. No user documents uploaded.
- Executed the actual `db/storage_policy_audit.sql` (excluding its psql-only `\echo` directive) against this managed project: passed.
- Ran the **transaction-and-rollback** SQL in `ci/live_supabase_rls_smoke.sql` using managed Supabase `auth.uid()` and the real authenticated PostgreSQL role. Both synthetic organizations were isolated, and cross-tenant fact insertion was denied; after rollback the live database still contained **zero organizations, zero memberships and zero facts**. This is a role simulation, **not two real signed-in Auth users**.
- Supabase security advisors returned **zero findings** after both migrations. That does not constitute a full penetration or Storage API test.

The four versioned files in `supabase/migrations/` match these **actual managed migration versions**, and the source-sync generator plus GitHub Actions now check those files. The superseded all-in-one synthetic migration was deleted to avoid an accidental duplicate application. **These migrations are installed: never replay them directly on the same database.**

## Not yet complete — no production release

There is no provisioned tenant owner/user, authenticated frontend, real two-user API test, or trusted upload service. File contents must be hashed *server-side* and verified against the actual private Storage object before inserting an evidence receipt. Supabase Storage signed URLs, invitation/onboarding, session controls, service-key isolation and actual credential authenticity still require validation. Do not switch marketing/demo forms to active and do not publish legal, license or pricing claims based on this schema alone.

The preview remains `noindex`, but that is not access control. Keep PR #12 in **DRAFT** until real Auth, Storage API upload/download, policy isolation and deployment are tested with genuine sessions; PR #11 remains separately blocked on owner-approved quarterly pricing.

**Client configuration:** the project URL is `https://jgbogpunyzkoytrclqdl.supabase.co`. Obtain the current **publishable** API key using a secure deployment configuration; do not commit service-role or secret keys. No real user identity, email or password has been invented.

## Atomic quota migration — 2026-10-17 (2026-10-18 UTC)

- Applied only to the dedicated BidMason Supabase project: managed migration `20261018064847`, name `bidmason_atomic_evidence_upload_quota`, sourced from `db/upload_quota.sql`; versioned replay file `supabase/migrations/20261018064847_bidmason_atomic_evidence_upload_quota.sql`. Installed database schema does **not** imply a live upload endpoint.
- `bm_upload_quota` has RLS enabled, no client table privileges, and an atomic per-user/per-tenant hourly 12-attempt cap. `bm_reserve_upload_quota(uuid,uuid)` is SECURITY INVOKER, EXECUTE granted only to `service_role`, with narrowly scoped membership SELECT.
- Live managed project privilege check showed no quota SELECT/EXECUTE access for `anon` or `authenticated`; the trusted role has EXECUTE. Live transaction-and-ROLLBACK fixture granted 12 attempts, denied #13 and a nonmember; observed the counter at 12 within the transaction, then rolled back all synthetic rows.
- One security advisor **INFO** `rls_enabled_no_policy` finding is expected for the quota table, intentionally lacking client policies. Do not silence it by adding broad permissions. Previously reported zero findings do not apply to the new schema.
- No real authenticated user, hosted quota RPC, malware scanner, public upload path or production secret integration has been tested; do not enable customer uploads.
