# Item 4 — Server-only service scope review commit

The internal `lib/tenant-service-review.ts` composes the already-persisted
extractor candidates with the active, independently approved tenant ratecard.
It creates an audit-bound **human service selection**, never a proposal
approval or authorization to publish or send.

- A trusted `TrustedServiceReviewStore` implementation must verify the live
  authenticated reviewer, tenant membership, record ownership and the
  `review-extraction` permission inside **one durable compare-and-swap write**.
  It must derive the actor ID on the server; caller-provided roles, actor IDs,
  prices, send/approval flags, and altered source data are not accepted.
- `readServiceReviewContext` exposes current reviewable candidate rows and
  the expected source revision/snapshot after separately authorized checks
  against approved company policy and tenant-owned extraction evidence.
- `commitAuthorizedServiceReview` independently reloads the current approved
  policy; checks the original extraction audit fingerprints and revision;
  rebuilds the workbench and validates explicit service selection and every
  optional add-on acknowledgement **inside the source write transaction**.
  Only exact selected indices, active policy revision/hash and reviewed
  selection fingerprint are stored in `scopeReview`; no commercial price
  or customer-ready proposal is persisted.
- The result is `reviewed-for-proposal-draft` only after checking the exact
  expected transition against the backend response and performing a fresh
  authorized read-back from the primary/linearizable source. The authorized
  company policy is read again after the write; if it changed, return an
  indeterminate error, not a false approval. A record bound to a superseded
  company policy must be considered **stale downstream**, with separate
  binding checks required at any future proposal approval/publication.
- The state transition increments the source revision and disallows duplicate
  review on the same extraction. If read-back or policy revalidation fails,
  the write may already have committed. **Do not blindly retry**; reconcile
  the exact persisted source/review/policy state with fresh authorization.

Regression coverage tests the approved-only source/policy path, optional
add-on consent, stale/racing reviews, reviewer revocation, cross-tenant
isolation, source/extraction/audit tampering, unexpected client directives,
false backend write confirmation and stale policy activation.

**Not production acceptance:** The only backend in tests is a synthetic
in-memory store, not real Supabase Auth, RLS or private Storage. Genuine
multi-user PostgREST and Storage byte security, maintained AV, retention,
legal/privacy approval and customer-owned commercial terms remain required
before merging Items 3 or 4. No HTTP route, upload, quote send, billing,
or public customer workflow is enabled by this contract.

## Canonical persisted extraction evidence before scope review

The legacy, server-only scope-review adapter now validates authorized
read-back rows **before** accessing the extraction audit, reading candidate
values or constructing a source/review consistency checksum. Required
tenant/source/revision/original/review/audit/scope fields must be own
enumerable plain data. The extraction audit must be a dense, undecorated
one-element array containing an exact four-field plain-data record with
the authenticated source revision, actor ID and both SHA digests.

The existing shared extraction validator verifies the *entire* reviewed
candidate collection, exact source excerpts, original and candidate
digests before any actor/audit values are trusted. Its selected-index-zero
probe exists only to check evidence integrity; **it is not human scope
selection or optional add-on consent**. Malformed read-back is denied
before the first approved-policy read in the review-context path and
before an atomic scope write in the commit path. Regression tests cover
getter-backed fields, candidate/audit indexes, sparse/decorated
collections, hidden/symbol/inherited directives and changed hashes.

These in-memory contract checks do not replace current authenticated
source ownership, primary SQL transaction/CAS, real Supabase RLS and
Storage, independent reviewed ratecard approval or proposal delivery
authorization. The scope decision remains a draft-only transition.
