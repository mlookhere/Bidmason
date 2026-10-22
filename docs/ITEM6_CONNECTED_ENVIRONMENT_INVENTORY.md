# Item 6 — connected Supabase environment inventory (read-only, NOT acceptance)

**Observed:** 2026-10-22 via the connected Supabase project named **BidMason** (us-west-1, reported ACTIVE_HEALTHY). This is metadata reconnaissance, **not** two-user Auth/PostgREST acceptance, a security certification, or permission to enable real sending.

**Repo scope:** [Item 6 / Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft PR #15. The project identifier, tenant IDs, authentication material, customer records and environment credentials are intentionally omitted from this public source file. Source-of-truth acceptance remains [the H01–H13 runbook](ITEM6_EXTERNAL_ACCEPTANCE_RUNBOOK.md); `ITEM6_RELEASE_EVIDENCE.json` remains **blocked**.

## Connected metadata observed

| Area | Connected read-only observation | What it does **not** establish |
| --- | --- | --- |
| Schema | Nine applied BidMason migrations, from `bidmason_tenant_foundation` through `bidmason_verified_receipt_storage_read` | Migration parity with the current unmerged PRs, application deployment, or complete schema |
| Tenant tables | All eight `public.bm_*` tables have RLS enabled: organizations, memberships, business facts, fact reviews, brief revisions, brief approvals, evidence receipts and upload quota | Actual end-user JWT authorization, grant boundaries or resistance to tenant A/B access attempts |
| Current test fixtures | All eight tables have **zero rows** in exact aggregate COUNT queries | Any successful two-tenant integration test or approved customer record |
| Table policies | Twelve authenticated policies observed across the first seven tables; `bm_upload_quota` has RLS enabled with **zero** policies | That RLS conditions and service-only quota RPC grants have been validated in actual authenticated sessions |
| Private storage | `bm-evidence` bucket is not public; allowed MIME types: PDF, PNG, JPEG; limit 15,728,640 bytes; zero objects | Correct signed-link expiry, private download authorization, revocation, virus-scan readiness or cross-tenant negative tests |
| Storage policies | Eight `bm_evidence_*` object policies observed, including restrictive read/write boundaries and a membership-scoped authenticated upload/read path | Permission behavior under two independently authenticated users, malformed paths or stolen tokens |
| Backend integrations | No Supabase Edge Functions listed; `bm_reserve_upload_quota` is invoker-mode and not directly executable by `anon` or `authenticated` roles | Absence of external services elsewhere, provider integration, real transactional dispatch or customer delivery |
| Advisor | One **INFO** finding: `public.bm_upload_quota` has RLS but no policies ([RLS enabled, no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)) | A confirmed vulnerability: this may be an intentional server-only quota table. Review intended privileged access before changing policy |

## Read-only H01 permission and schema reconfirmation (2026-10-22)

A fresh, read-only `information_schema.columns`, `information_schema.role_table_grants`, `pg_policies` and aggregate-count inspection established that `bm_organizations`, `bm_memberships` and `bm_brief_revisions` have `SELECT` grants for the **authenticated** role, but **no direct anonymous SELECT grants**. Both `bm_brief_revisions.id` and `bm_brief_revisions.organization_id` exist as non-null UUID columns (the H01 probe's intentionally minimal selection). The current organization/revision RLS SELECT policies depend on matching `bm_memberships` using `auth.uid()`; membership SELECT is scoped to `user_id = auth.uid()`. All three tables still had **zero rows** when checked. This is **metadata**, not signed-in test evidence.

**Implication for the opt-in H01 probe:** A no-grant anonymous PostgREST request may return HTTP **401/403**, which is a valid *negative-disclosure* outcome after signed-in positive controls have demonstrated the API is operating. HTTP 200 with an exact empty array is also acceptable for anonymous checks. Only those *three anonymous* checks accept a 401/403, and only when no data is returned. Signed-in own-tenant positive controls and other signed-in isolation checks still require HTTP **200 with exact expected results**. HTTP 302/400/500 and any leaked anonymous row must fail. The read-only probe never issues grants or weakens RLS.

These observed SQL grants do **not** establish PostgREST's configured exposed schemas, successful real bearer sessions, session revocation, complete cross-tenant permission denial, production readiness, or authorization to create data. Live H01 acceptance and all H02–H13 gates remain **unverified**.

## Mandatory connected acceptance not yet performed

1. **H01 — Auth and RLS:** Provision two independently authenticated *synthetic* tenant users through authorized staging processes, not SQL role impersonation. Verify expected same-tenant access and deny cross-tenant SELECT/INSERT/UPDATE/DELETE, enumeration, missing membership, and session revocation using actual issued JWTs / PostgREST responses. Record exact test SHA, responsible independent reviewer and sanitized logs in restricted evidence storage.
2. **H02 — Private storage:** With authorized synthetic users, test tenant-specific uploads and reads, wrong-tenant path and object access, signed-link expiration and revocation, uploader permissions, malicious file paths, unsupported file types and boundary sizes. Collect provider responses and independent review without committing signed URLs or personal data.
3. **H03–H13 — Send and release:** Live company-specific price policy, QA/content revision signers, attributable consent, selected mail provider/domain/native signed callback, transactional outbox and suppression race tests, buyer portal, operational recovery and separate security/privacy/legal/operations release signoffs are **not established** by this database inventory.

**Safety boundary:** All SQL executed for this inventory was read-only catalog inspection or aggregate counts; no row contents, authentication tokens, provider data, storage objects or production migrations were modified. Do not promote this inventory to `submitted-for-independent-review` on its own: an observed table, policy or empty bucket is not an independently tested access control.

## Reproduce the safe metadata checks

Run these **read-only queries** against the *explicitly selected BidMason environment* through an authorized administrator; do not automate production database writes or use impersonated JWT claims as proof:

```sql
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'bm_%'
ORDER BY tablename, policyname;

SELECT policyname, permissive, roles, cmd
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
AND policyname LIKE 'bm_evidence%' ORDER BY policyname;

SELECT name, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE name = 'bm-evidence';

SELECT
  (SELECT count(*) FROM public.bm_organizations) AS organizations,
  (SELECT count(*) FROM public.bm_memberships) AS memberships,
  (SELECT count(*) FROM public.bm_business_facts) AS facts,
  (SELECT count(*) FROM public.bm_fact_reviews) AS fact_reviews,
  (SELECT count(*) FROM public.bm_brief_revisions) AS revisions,
  (SELECT count(*) FROM public.bm_brief_approvals) AS approvals,
  (SELECT count(*) FROM public.bm_evidence_receipts) AS receipts,
  (SELECT count(*) FROM public.bm_upload_quota) AS quota_rows;
```

**Status: BLOCKED. H01–H13 remain unverified. `releaseAuthorized: false`.**
