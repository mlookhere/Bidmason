# Tenant model — isolated PostgreSQL baseline

This is a **SQL proof-of-concept**, not a deployed Supabase migration. The connected Supabase account has no project called BidMason. We will not apply schema changes to unrelated projects.

Files: `db/schema.sql` defines public tables, indexed membership checks, fail-closed grants/RLS policies, immutable proposed fact/revision records, operator-only approval inserts, independently reviewed fact evidence with a security-invoker verified view, column-restricted client INSERT grants that prevent forged actor/timestamp fields, a PostgreSQL-calculated SHA-256 check tying every immutable revision to its exact canonical JSONB bytes, and a `security_invoker=true` view that returns only the newest approved brief revision.

The trusted backend (future work) must provision organizations and memberships. A browser session must **never** be able to grant itself operator/owner access or mark a license/insurance claim verified. Auth identities are taken from `auth.uid()`, not mutable user metadata.

`ci/db_auth_stub.sql` simulates just the Supabase `auth.uid()` contract in an **ephemeral CI PostgreSQL** service. It must never be deployed. `ci/db_rls_test.sql` runs positive and negative two-tenant tests using real SQL role switching, checking:
- User A can see tenant A, not tenant B.
- User C from tenant B cannot read or approve any of tenant A's records.
- A contractor cannot self-promote or approve proposals.
- A contractor cannot self-verify credentials: only an owner/operator can create an immutable fact-review decision with a nonblank evidence reference and rationale, and unreviewed facts are invisible to the verified-facts view.
- Edits create a new immutable revision; the formerly approved version is no longer current. An attempted forged revision digest and approval of an older *unapproved* revision are rejected.
- No identity means no tenant records; all six public tables have RLS enabled.
- The current-approved view is security-invoker, not definer.

**Important:** No production Auth, Storage, migrations, policy publication, subscriptions, deployment, or two-tenant Supabase live test is claimed. Complete Issue #4 only after translating this verified schema draft to real generated migrations, running Supabase security advisors, integrating auth and private file storage, and verifying two real sessions under project-specific permission controls.

Supabase documentation: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/api/securing-your-api

A second SQL suite (`ci/db_fact_review_test.sql`) runs after the original two-tenant fixtures and proves client timestamp spoofing, unauthorized contractor reviews, cross-tenant evidence disclosure and blank evidence are rejected. **The evidence reference is an unvalidated string until a real private Storage policy and evidence ingestion flow exist.** No verified claim may be published from this draft alone.
