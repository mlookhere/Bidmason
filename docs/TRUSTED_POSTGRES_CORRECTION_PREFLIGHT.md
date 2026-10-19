# Item 4 — Real PostgreSQL correction preflight, writes unavailable

**Staging only.** This milestone adds a source-authorized PostgreSQL
*read-only* adapter, not a correction persistence implementation. The existing
disposable database schema (`db/typed_note_foundation.sql`) limits intake
revisions to 1–3, with no `pendingCorrection` / `activatedCorrection` storage
and no independently checked correction CAS. Writing a correction through
that schema would be unsafe, especially after an original scope was reviewed.

`lib/trusted-postgres-correction-preflight.ts` takes a server-side active Auth
verifier and privileged primary database port. It calls the existing private
`bm_intake_private.read_typed_note_for_extraction` SQL function, which checks
current membership before source lookup and restricts the result to the
creator. The adapter verifies authenticated identity again after SQL, enforces
exact SQL projection fields, validates original text SHA, creation evidence,
full extraction and optional original scope, and exposes extracted revisions
to the existing `readExtractionCorrectionContext` read-only preparation.
An unextracted source remains unavailable for correction. Changed/malformed
DB projections, foreign tenants, revoked roles and changed Auth identities
fail closed. The schema does not claim corrected state: nullable correction
fields are projected only after proving the exact eight-field original
schema.

`mutateAuthorized` unconditionally rejects **before invoking any callback
or SQL**, including the editor submission bridge. No fake persistence, write
fallback, retry, quote approval, customer communication or production route
is enabled. A future staged correction-specific transaction must also block
old approved scope / proposal readers at the database level, durably store
immutable pending history, and provide real two-user PostgREST/RLS/private
Storage and signed AV evidence before writes can be enabled. Supabase Auth,
RLS and original Storage are not independently verified by these tests.

`tests-web/trusted-postgres-correction-preflight.test.mjs` exercises strict
adapter inputs and mutated/forged authorized DB replies in memory.
`ci/intake_correction_preflight_bridge.test.mjs` runs the adapter against
the actual isolated PostgreSQL private function and current membership,
including revoked/cross-tenant/same-tenant foreign-actor denials and zero
correction writes. This is a diagnostic safety gate, not production readiness.
