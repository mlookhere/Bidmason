# Item 4 — Trusted extraction correction commit boundary

`lib/tenant-extraction-correction.ts` adds an **internal, server-only**
authenticated transaction contract that consumes the existing, pure,
human-explained extraction correction drafts. This is an adapter interface,
**not a connected Supabase database or a production API route**.

`readExtractionCorrectionContext` authenticates the same tenant/source
through two separate authorized primary reads and gives a revision/snapshot
checksum. `commitAuthorizedExtractionCorrection` passes only a selector,
expected hashes and human change proposals to a trusted store. Within a
**single atomic transaction** the adapter must recheck current membership,
source ownership, `correct-extraction` permission and CAS. The server
recalculates every proposed candidate and its corrected digest from the
stored original and *unaltered* provider extraction, obtaining the actor ID
from the trusted adapter. Browser-supplied prices, actor identities,
approval claims and complete corrected reviews are not accepted.

The transaction keeps the original source, provider extraction and its
extraction audit immutable; it increments the source revision, saves a
`pending-authorized-activation` correction audit including old/new details
and an invalidated prior scope review, and resets `scopeReview` to null.
The returned `correction-committed-pending-activation` state is **not**
activated for selection, pricing, proposal drafting, or sending. Existing
authorized intake preview paths refuse records with a pending correction,
and the existing service-review transition refuses the old extraction
revision; previously reviewed scope also fails proposal draft requirements.

A confirmed return requires a freshly authorized, primary/linearizable
read-back of the *exact* mutated record and audit. A lost read-back is
**indeterminate**; do not retry the request or issue any quote without
reconciling trusted state. The production adapter must persist the added
pending-correction schema transactionally, protect the append-only audit
and enforce the same gates; this repository currently has no live
Supabase adapter or Auth/RLS/AV approval evidence.

**Still required:** a separate, authenticated activation transition
that converts the pending candidate proposal to a newly reviewed
extraction with an immutable lineage record and invalidates any
old scope. Do not shortcut that transition by treating a pending
correction as verified model output or an approved price.

## Read-only correction recovery

`reconcileExtractionCorrection(store, session, originalCommitRequest)` is
available when an authenticated correction transaction has a lost response,
revoked read-back or other **indeterminate** outcome. It accepts the same
original expected source revision, snapshot hash and source-exact human
changes, and performs **two independent, authorized, primary reads**.

Results are deliberately narrow: `unchanged-at-read` means only that both
observations match the original exact snapshot; it does *not* prove a
transaction rolled back or cannot commit later. `recorded-pending-at-read`
requires the committed next revision, preserved original source/extraction
and audit, exact saved invalidated scope, matching source/correction hashes,
and a full recomputation of the server-validated before/after candidates.
It proves only that compatible **pending** evidence was observed, not
authenticated historical permissions, approval, activated scope or a
production-ready quote. `conflict` means evidence is changed, malformed,
incompatible or differs between primary reads; it grants no retry rights.
An inaccessible, deleted or unauthorized record raises an error instead
of being represented as a confirmed rollback.

No reconciliation path writes, retries the mutation, changes the active
review, signs any business decision or authorizes sending. The production
adapter still needs independently validated, append-only tenant persistence
and authorization; tests use synthetic in-memory transactions only.

## Independent activation (still not a priced selection)

`readExtractionActivationContext` validates a persisted pending correction
and performs **two independent authorized primary reads** before returning a
revision/snapshot/correction-digest binding. `commitAuthorizedExtractionActivation`
requires the *distinct* `activate-extraction-correction` permission checked
by the trusted adapter against current membership and source ownership
inside a locked atomic compare-and-swap transaction. A server-trusted actor
identity, the exact pending original revision, all before/after candidate
evidence and SHA-256 values are recomputed and verified. A fresh authenticated
read-back is required to confirm the write; an uncertain write is not retried.

Activation moves the source into `awaiting-renewed-human-scope-review`:
the original provider extraction and extraction audit remain intact, the
corrected candidate review is stored as a separate new data record, and
the pending human correction plus invalidated previous scope remain in
the immutable activation lineage. Active `scopeReview` stays NULL.
Existing tenant intake and pricing/preview paths **reject** records with
activated corrections instead of falling back to the original provider
suggestions. This prevents a correction from being mistaken for a
commercial approval. A future distinct, authorized renewed scope-review
workflow must validate the new corrected review and policy before any
pricing preview can be used.

This is a pure server-side contract tested with synthetic adapter behavior,
not a deployed PostgREST transaction or independently verified permission.

## Canonical persisted audit and previous-scope evidence

The correction read/commit boundary now inspects persisted authority-bearing
record fields, extraction audit array/indexes, and all four stored audit fields
as **own enumerable plain data** before accessing actor identities or revision
digests. It runs the existing complete source and extraction-candidate
provenance validator before evaluating or serializing correction context.
Hidden, inherited, symbol-decorated, sparse and getter-backed audit evidence
is denied without executing the getter.

When an earlier human-reviewed scope is present, that scope must likewise
be canonical: exact plain fields, dense approved-selection and acknowledgement
arrays, and primitive digest/identity fields. A malformed scope may not be
silently invalidated into a supposedly valid correction lineage. Synthetic
regression tests cover malicious persisted record, candidate, audit and
prior-scope getters while retaining the separate authenticated correction
and activation steps.

This is an *internal adapter trust boundary*. The checksum is not a
signature; trusted current-tenant Auth, atomic CAS, immutable source/audit
storage, reviewer grants, real RLS and independent human approvals remain
mandatory for any staging or production use.
