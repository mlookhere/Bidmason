# Tenant model — isolated PostgreSQL baseline

This is a **SQL proof-of-concept**, not a deployed Supabase migration. The connected Supabase account has no project called BidMason. No unrelated project is used or modified.

Files: `db/schema.sql` defines the six core public tables, indexed membership checks, fail-closed grants/RLS policies, immutable proposed fact/revision records, operator-only approval inserts, independently reviewed fact evidence with a security-invoker verified view, column-restricted client INSERT grants that prevent forged actor/timestamp fields, a PostgreSQL-calculated SHA-256 check tying every immutable revision to its exact canonical JSONB bytes, and a `security_invoker=true` view that returns only the newest approved brief revision.

The trusted backend (future work) must provision organizations and memberships. A browser session must **never** be able to grant itself operator/owner access or mark a license/insurance claim verified. Auth identities are taken from `auth.uid()`, not mutable user metadata.

`ci/db_auth_stub.sql` simulates just the Supabase `auth.uid()` contract in an **ephemeral CI PostgreSQL** service. It must never be deployed. `ci/db_rls_test.sql` runs positive and negative two-tenant tests using real SQL role switching, checking:
- User A can see tenant A, not tenant B.
- User C from tenant B cannot read or approve any of tenant A's records.
- A contractor cannot self-promote or approve proposals.
- A contractor cannot self-verify credentials: only an owner/operator can create an immutable fact-review decision with a nonblank evidence reference and rationale, and unreviewed facts are invisible to the verified-facts view.
- Edits create a new immutable revision; the formerly approved version is no longer current. An attempted forged revision digest and approval of an older *unapproved* revision are rejected.
- No identity means no tenant records; all six core public tables have RLS enabled; the separate receipt extension adds a seventh RLS-protected table.
- The current-approved view is security-invoker, not definer.

**Important:** No production Auth, Storage, migrations, policy publication, subscriptions, deployment, or two-tenant Supabase live test is claimed. Complete Issue #4 only after translating this verified schema draft to real generated migrations, running Supabase security advisors, integrating auth and private file storage, and verifying two real sessions under project-specific permission controls.

Supabase documentation: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/api/securing-your-api

A second SQL suite (`ci/db_fact_review_test.sql`) runs after the original two-tenant fixtures and proves client timestamp spoofing, unauthorized contractor reviews, cross-tenant evidence disclosure and blank evidence are rejected. **The evidence reference is an unvalidated string until a real private Storage policy and evidence ingestion flow exist.** No verified claim may be published from this draft alone.

## Draft private evidence Storage policy

`db/storage_policies.sql` seeds a **non-public** `bm-evidence` bucket with a 15 MiB limit and PDF/PNG/JPEG allowlist, and adds `storage.objects` policies for names following `<organization-uuid>/<object-uuid>.<extension>`. Authenticated members may create **new** objects under their own organization only if Storage's `owner_id` matches `auth.uid()`. Organization owners/operators may read their tenant's evidence; contractors may read only their own uploads. Client UPDATE and DELETE are intentionally absent; overwrites and cross-tenant reads are denied.

`ci/db_storage_stub.sql` stands in for the live Supabase Storage schema **only in disposable PostgreSQL CI**, and `ci/db_storage_test.sql` exercises the actual RLS expressions and adversarial owner/path/tenant/mutation cases. This does **not** prove real Supabase Storage upload behavior, MIME enforcement, file integrity, revocation, immutable object contents, or access through generated/signed URLs. Those require a dedicated project, the real Storage system, retention policy and authenticated client tests. Storage policy code must be reviewed against the selected project's live Storage schema before any migration.

## Server-issued evidence receipts

`db/evidence_receipts.sql` adds `bm_evidence_receipts`, an append-only, server-only record of private Storage key, digest, size and MIME type. A composite foreign key requires every `bm_fact_reviews.evidence_reference` to match a receipt belonging to **the same organization**. Tenant members may read their own receipts, but cannot mint or modify one. The authenticated client cannot invent a path and then use it to verify an unsupported business claim.

The CI test seeds *synthetic* receipts as the privileged test fixture (no real bytes are present), and checks forged receipt insertion, missing evidence, cross-tenant receipt references and path/size/hash shape. **The receipt's digest is not authenticated merely by SQL insertion**; a future server-side ingestion flow must hash real uploaded bytes and confirm Storage ownership, MIME and lifecycle before minting any production receipt. This file is a schema draft, not a deployed migration.

## Effective Storage policy-set preflight

PostgreSQL combines multiple permissive RLS policies with **OR**. Therefore the mere presence of BidMason's two intended private-object policies cannot prove its bucket is private if any other policy on `storage.objects` provides access. Before any candidate deployment, `db/storage_policy_audit.sql` performs a **fail-closed, session-local** check of the non-public bucket, file restrictions, RLS setting, expected policy names, commands, authenticated roles, and minimum tenant/owner predicates. It rejects **any additional Storage object policy** until explicitly reviewed, including policies whose apparent scope is another bucket. This deliberately creates a review step for shared projects; do not disable or silently whitelist an unreviewed policy to force green CI.

In the isolated PostgreSQL `db-rls` job, `ci/db_storage_audit_test.sql` injects an overly permissive third SELECT policy, replaces the allowed INSERT expression with `true`, and replaces the private-read expression with `true`. Each attack must be detected; each mutation is rolled back and the original policy set must pass again. This introspection is a **defense in depth** check, not semantic verification of arbitrary SQL. It does not validate Storage API uploads, signed URLs, or the policy set of a live Supabase project. Run against the eventual authorized project's actual policies and inspect policy interaction manually before applying anything.

## Restrictive Storage defense against shadow policies

The initial `bm-evidence` read/upload policies were permissive. In PostgreSQL, an additional permissive `storage.objects` policy is **OR-composed**, and can widen access even when BidMason's two original predicates remain present. The draft now adds restrictive read/upload boundary policies for `PUBLIC` that are AND-composed with any permissive policy. Restrictive update/delete rules block mutations of `bm-evidence` objects even if another policy grants access. All four boundaries **apply only to `bm-evidence`**; for other buckets the boundary expressions permit their independently authorized operations to proceed.

The PostgreSQL `ci/db_storage_audit_test.sql` deliberately adds a broad `FOR ALL` policy and checks that Tenant B cannot read/insert Tenant A evidence and that Tenant A cannot rename/delete evidence. A separate rollback scenario proves that an unrelated bucket's own read/write rules still work. The separate `db/storage_policy_audit.sql` still fails closed on any unreviewed shadow policy before a proposed live deployment. These are isolated SQL checks, **not** proof of the effective permissions in a live Supabase project, Storage upload API, service role, signed URL, or other Supabase version.
