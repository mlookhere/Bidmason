# Item 4 — Staged correction quarantine (not correction persistence)

The disposable PostgreSQL CI schema now has a **one-time, creator-scoped correction quarantine** for existing extracted typed notes (revisions 2 or 3). This is an intentionally narrow precursor to durable corrected-candidate persistence, not a complete correction workflow.

The private `quarantine_typed_note_for_correction` function:
- Requires current organization membership and the **original creator**; locks membership and source in one transaction.
- Verifies exact expected revision, original source digest, stored canonical extraction candidate digest and one original extraction audit.
- Stores a human reason and an **opaque request fingerprint** in a privately owned, immutable one-row-per-source receipt table.
- Atomically advances source revision to **4**, preserves original text, provider extraction, and extraction audit, clears the older `scope_review`, and stores a minimal quarantine marker.
- Refuses replays, stale revisions, foreign tenants and missing membership. No client/browser role may call the function or edit the private receipt table.

The existing source-table trigger requires a matching private receipt for the revision-4 transition. The older scope/extraction writer paths require revisions 2/3 or 1 respectively; they **reject revision 4**, preventing legacy scope reuse. The existing TypeScript correction preflight and correction mutation remain fail-closed for revision 4. The source is deliberately *not quotable* after quarantine.

**Important limits:** The request SHA is not independently verified against proposed changes by this SQL function. No corrected candidates, correction approval, human activation or new scope are committed. The expected next independently reviewed step is atomic append-only corrected-candidate storage and validation of every change/excerpt/fingerprint, followed by separate approval and renewed scope-review protocols. The existing TypeScript source verifier only accepts revisions 1–3, so it must not be switched to write/read revision 4 as an approved proposal.

**Verification:** `ci/db_intake_correction_quarantine_test.sql` is mandatory in the existing `intake-db` Actions job, AFTER all legacy source/policy/scope checks. It proves a real PostgreSQL quarantine, private receipt, denial of direct forge, foreign-actor/tenant access, stale/replay and legacy extraction/scope paths. The fixture is synthetic. This does not establish live Supabase Auth, authenticated storage, production deployment, legally approved terms, or permission to send.
