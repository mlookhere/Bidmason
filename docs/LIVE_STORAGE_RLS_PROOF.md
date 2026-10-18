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

## Ninth migration and rollback-proof update (October 18, 2026)

The rollback-only diagnostic now **requires** the ninth
`bm_evidence_verified_receipt_read` policy before inserting any synthetic
objects. It rejects the older seven-policy state, where the tenant owner could
read a staged, unscanned object without its trusted receipt. After the
quarantine migration, the expected owner-visible count is **one verified
object**, not two. The probe also tests immediate read revocation when the
trusted receipt is removed, and verifies after `ROLLBACK` that all synthetic
organizations, memberships, receipts and Storage metadata are absent.
The `db-rls` job rehearses the exact script on a **third clean isolated**
PostgreSQL database after replaying all nine migrations, so a mismatch in
the actual live operator procedure blocks CI.

**Do not run the updated script against the connected managed project yet:**
the live ninth migration remains unapplied as of the last read-only policy
inspection. The SQL is not a deployment mechanism. Even when the live RLS
rehearsal is eventually authorized and passes, genuine Supabase Auth sessions,
actual Storage bytes, service-key handling and deployed malware scanning
remain separately required for release.
