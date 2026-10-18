# Server-only atomic evidence upload quota

**Status:** isolated SQL and TypeScript adapter under draft PR #12; no customer uploads or server deployment enabled. The SQL must be applied only to dedicated BidMason Supabase project `jgbogpunyzkoytrclqdl` after branch CI and reviewed migration checks.

- `db/upload_quota.sql` defines RLS-enabled `bm_upload_quota` and `bm_reserve_upload_quota(uuid,uuid)`. A reservation checks actual tenant membership, then inserts or atomically increments an hourly counter using PostgreSQL `ON CONFLICT DO UPDATE ... WHERE attempts < 12`. Every attempt consumes its permit, even when a later upload fails; no free retry loophole.
- Current conservative ceiling: **12 upload attempts per user per organization per hour**, subject to future pilot cost/abuse evidence. This is not a public pricing or SLA promise. No IP-based unauthenticated edge rate limit is supplied here.
- The RPC uses **SECURITY INVOKER**, and only `service_role` receives EXECUTE. The quota table has RLS enabled, with no `anon`/`authenticated` grants. The service role's privileged key must never leave trusted server code.
- `lib/supabase-upload-quota.ts` exposes `createSupabaseUploadPermit()`, pinned to the BidMason Supabase RPC endpoint, validates canonical user/tenant UUIDs, requires a server-only `sb_secret_` credential, refuses redirects and invalid responses, and fails closed on provider errors.
- `ci/db_upload_quota_test.sql` checks 12 granted + 13th denied, separate tenant quota, unauthorized identities, client RPC/table denial and invoker/RLS privileges. `tests-web/supabase-upload-quota.test.mjs` checks the HTTP adapter contract under deterministic mocks.

**Operational gate:** This adapter is deliberately not wired to an enabled POST route or provisioned scanner. The schema's client-denial behavior must be verified against actual managed Supabase permissions, and the RPC exercised with a trusted server-side connection before any activation. Account/session authorization remains mandatory in `processEvidenceUpload()`, with a fresh authorization in `ingestForSignedInMember()` before inserting the verified receipt. A valid permit alone conveys no Storage access.

Quota rows are operational telemetry with user UUID and tenant references; retention/cleanup must be handled by an auditable trusted job before production, and no service key may be logged. A rate limit after Auth does not replace per-IP/network ingress throttling.
