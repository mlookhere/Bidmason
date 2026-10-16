# Tenant model — isolated PostgreSQL baseline

This is a **SQL proof-of-concept**, not a deployed Supabase migration. The connected Supabase account has no project called BidMason. We will not apply schema changes to unrelated projects.

Files: `db/schema.sql` defines public tables, indexed membership checks, fail-closed grants/RLS policies, immutable proposed fact/revision records, operator-only approval inserts, and a `security_invoker=true` view that returns only the newest approved brief revision.

The trusted backend (future work) must provision organizations and memberships. A browser session must **never** be able to grant itself operator/owner access or mark a license/insurance claim verified. Auth identities are taken from `auth.uid()`, not mutable user metadata.

`ci/db_auth_stub.sql` simulates just the Supabase `auth.uid()` contract in an **ephemeral CI PostgreSQL** service. It must never be deployed. `ci/db_rls_test.sql` runs positive and negative two-tenant tests using real SQL role switching, checking:
- User A can see tenant A, not tenant B.
- User C from tenant B cannot read or approve any of tenant A's records.
- A contractor cannot self-promote or approve proposals.
- A client cannot self-verify credentials.
- Edits create a new immutable revision; the formerly approved version is no longer current.
- No identity means no tenant records; all public tables have RLS enabled.
- The current-approved view is security-invoker, not definer.

**Important:** No production Auth, Storage, migrations, policy publication, subscriptions, deployment, or two-tenant Supabase live test is claimed. Complete Issue #4 only after translating this verified schema draft to real generated migrations, running Supabase security advisors, integrating auth and private file storage, and verifying two real sessions under project-specific permission controls.

Supabase documentation: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/docs/guides/api/securing-your-api
