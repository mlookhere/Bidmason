# Live Supabase Storage RLS rollback-only proof

**Scope:** Dedicated BidMason project `jgbogpunyzkoytrclqdl`. Execute `ci/live_storage_rls_rollback.sql` only with an audited, privileged database operator. This is **not a migration**, not an enabled production test, and must never run against a project containing user, tenant or Storage data. It begins with an empty-project guard and ends with an unconditional explicit `ROLLBACK`; never run excerpts separately, remove the rollback, or turn it into a scheduled job.

## Observed result — October 18, 2026

Executed the equivalent SQL through the connected Supabase SQL interface on the real dedicated project. It returned:

```text
PASS live Supabase PostgreSQL RLS; transaction rolled back
```

A *separate* read-only verification immediately afterward found **0 Auth users, 0 tenant organizations, 0 memberships, 0 evidence receipts and 0 private bucket objects**. Thus the synthetic metadata, memberships and simulated user claims were not persisted. No real Storage blob, customer file, signed URL, or test Auth identity was created.

The proof exercised authentic PostgreSQL `authenticated` role and `auth.uid()` RLS evaluation with synthetic `request.jwt.claim.sub` values inside one transaction: own receipt-backed contractor visibility with `owner_id=NULL`, denial to another same-tenant contractor, owner visibility, denial across tenants/missing Auth, denial of bypass direct Storage INSERT, and immediate revocation after deleting the membership inside the rolled-back transaction.

## What it does not prove

The test **does not authenticate through Supabase Auth**, issue JWTs, perform genuine HTTP Storage object upload/download, verify body bytes or virus signature freshness, prove hosted `sb_secret_` handling, or establish token-session revocation. Genuine two-user, two-tenant Storage **API** positive/negative tests, deployed scanner, idempotent retry, retention/privacy signoff and production controls remain blocking. Keep PR #12 DRAFT and all customer upload endpoints disabled.

This script is preserved as reproducible, non-production database-layer evidence; independently inspect the fixed project ID and use a separately approved genuine Auth/Storage integration harness for full release acceptance.
