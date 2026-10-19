# Item 4 — Staged tenant typed-note database foundation

File: db/typed_note_foundation.sql. STAGING ONLY: not a Supabase migration,
not deployed and not a customer-facing API. Do not deploy before Item 3
authenticated two-user tenant/RLS/Storage-byte/antivirus acceptance.

The schema supplies tenant-scoped immutable creation identity, original
note text capped at 64 KiB, server-generated source UUID, database-verified
text SHA-256 and revision-bound review/audit states. A separate typed-note
request ledger has unique (organization_id, actor_id, request_id) identity
and a five-column foreign key covering source UUID, actor, request and digest.
Conflicting content under a reused idempotency key is rejected.

All new tables have RLS enabled and forced. Neither anon nor authenticated
has direct SELECT/INSERT/UPDATE/DELETE grants. The private-schema function
uses SECURITY INVOKER, is explicitly executable only by service_role, and
checks current membership with a row lock. It inserts/reuses a source and
writes/verifies the ledger in one database transaction. No public RPC
or browser entry point is supplied.

Critical: The function's actor parameter is trusted ONLY when a future
backend derives it from a freshly verified server Auth session. It must
never accept a browser actor or expose service_role credentials. This
isolated database primitive does not itself prove valid identity, resolve
revoked sessions, or implement the JavaScript trusted-store adapter.
The private schema requires a controlled database connection rather than
an exposed PostgREST endpoint.

Only typed notes are supported; transcripts/files, extraction mutations,
policy approvals, proposals, outbound delivery and billing are out of scope.
A separate transactional CAS-backed extraction/review adapter is required.
Real DB deployment, auth and security testing remain uncompleted release gates.
