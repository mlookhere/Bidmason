# Item 4 — Explicit renewed human review of activated extraction corrections

**Status:** internal, server-only authorization and transaction contract;
no production Supabase adapter, customer-facing review endpoint or send path.

`lib/tenant-corrected-scope-review.ts` adds a separate
`review-corrected-extraction` permission. It MUST be enforced by a trusted
tenant/source-owned, locked and atomic CAS writer—not by the browser.

A pending correction first requires independent authorized activation. The
activated record retains immutable provider extraction and creation audit,
the original human correction, a separate corrected extraction review and
the invalidated prior scope. The renewed review service reconstructs the
pre-activation record, revalidates every original/proposed candidate and
fingerprint, and recomputes the activation SHA-256. Two fresh, independently
authorized source and approved company-policy reads must agree before showing
the corrected review workbench. No former scope selection is reused.

A human supplies explicit canonical candidate indices and separately
acknowledges optional add-ons. The locked write recomputes policy eligibility,
selection and deterministic economics from the current approved tenant
policy and corrected source. The authenticated actor is obtained from the
trusted store, not supplied by the client. A fresh authorized read-back and
current policy check are required before a successful response. Failed
read-back is **indeterminate**, not a proven rollback or permission to retry.

The decision is saved only in `correctedScopeReview` with state
`reviewed-corrected-scope-internal-only`; **original `scopeReview` stays
NULL** and the original provider extraction plus corrected activation lineage
remain unchanged. Existing proposal draft, old intake preview and outbound
paths cannot treat the corrected review as authorization. Another separate
trusted proposal-draft integration would be needed to revalidate this exact
revision and policy, and later proposal release would still need independent
final approvals.

Tests exercise positive scope selection, separately acknowledged optional
services, concurrent CAS, revocation, cross-tenant denial, policy drift,
malformed/forged requests, tampered lineage, fake acknowledgements and lost
authorized read-back. They are synthetic in-memory contract tests, not a
live multi-user PostgreSQL/Supabase Auth/RLS/Storage proof.
