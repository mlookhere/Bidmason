# Item 4 — immutable company pricing revision transitions

\`lib/company-policy-revisions.ts\` adds pure state transitions over
organization-scoped draft, approved, and rejected pricing revisions.
Every draft has an exact revision number and deterministic content
SHA-256; a second, distinct reviewer must explicitly approve or reject.
An approved predecessor remains active during review or rejection of
the successor. The active revision changes only after an explicit,
independent approval. Pending/unapproved services are allowed in a
draft catalog but still cannot be quoted by the economics engine.

The caller supplies the **expected latest revision and SHA-256** to
prevent stale update attempts. All transitions clone snapshots and
verify the complete input history for revision gaps and modifications;
a persisted adapter must enforce the expected head atomically, not just
compare it in memory. Pricing validation rejects invalid rules, negative
or unsafe integer cents, unsupported service states, tax mismatches
and unknown excluded service codes.

**Not a security authorization implementation:** This module accepts
opaque caller-provided actor IDs, so its distinct reviewer rule is only
a domain invariant. A trusted server/storage adapter must derive actor
identity and organization membership from authenticated sessions, apply
row-level protection and durable compare-and-swap transactions, and
retain immutable approval evidence. No production policy records,
database migrations, sending, customer forms, or uploads are enabled.

\`tests-web/company-policy-revisions.test.mjs\` covers two-company
isolation, stale writes, reviewer separation, rejection, active version
invalidation and tampered history. Item 3's deferred live Auth tests
remain mandatory for deployment.

## Canonical policy data integrity

The same canonical policy SHA-256 is used by preview calculations, immutable draft history, and the trusted PostgreSQL policy adapter. The serializer refuses non-JSON representations, including hidden or accessor-backed prices, symbol fields and noncanonical arrays, rather than silently hashing different values from those used by the pricing engine. This is **only a consistency digest**, never authorization; tenant membership and independently approved persisted revisions remain mandatory. Positive and adversarial regressions are in `tests-web/company-policy-revisions.test.mjs`.

## Submitted-policy schema and snapshot boundary

An untrusted policy object is now canonicalized *before* draft validation or persistence: `canonicalCompanyPolicyText` verifies only canonical JSON-owned enumerable data properties and never calls a caller-defined `toJSON` or price accessor. The normalized policy is then checked against an exact business schema at top level, pricing, minimum, tax, and each service. Unknown directive fields (e.g., apparent send approval or price overrides) are rejected rather than silently retained or ignored. The same canonical policy bytes determine the saved SHA-256. Positive and adversarial tests cover this boundary in `tests-web/company-policy-revisions.test.mjs`. These are pure in-memory contracts; real authenticated reviewers and atomic tenant-persisted approvals remain separate requirements.

## Single-snapshot economics evaluation

`previewCompanyEconomics` now canonicalizes a complete caller-supplied versioned policy into an independent JSON data snapshot **before** checking tax settings, exclusions, service rates, declared direct costs, or generating the quote. Every calculated monetary amount, policy revision, and returned SHA-256 is derived from that same snapshot. This prevents divergence when the original mutable policy changes during calculation and rejects accessor-backed rates/taxes/costs, custom `toJSON` hooks, symbol/hidden directives and other noncanonical representations before executing untrusted getter code. New tests in `tests-web/company-economics.test.mjs` cover expected revised totals and rejected malformed object representations. The canonical SHA remains a **consistency fingerprint only**—not proof of authenticated tenant membership, independently approved rates, tax law compliance or permission to send a quote.
