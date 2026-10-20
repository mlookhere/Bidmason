# Item 4 — Internal read-only draft preview of corrected human scope

**Status: preview-only. Not an approved quote, customer proposal, release,
signing authority, or delivery authorization. No public route or live
Supabase production adapter is provided.**

The internal function `readAuthorizedCorrectedProposalDraftPreview` consumes
only a tenant-owned, persistently recorded and independently human-reviewed
`correctedScopeReview`. It requires two fresh, independently authorized
primary reads of both tenant source and the active approved company policy.
It verifies the immutable original extraction and human correction lineage,
the activation fingerprint and revision, and the separately reviewed
corrected scope. The original `scopeReview` must remain null.

Every stored renewed-review field must match a fresh calculation from the
**corrected** candidate review and the current company-owned approved policy:
review key, source/candidates SHA-256, selected indices, optional-add-on
acknowledgements, pricing policy revision and fingerprint, reviewer identity,
activation SHA and reviewed-selection SHA. All monetary amounts are
recomputed from the approved policy, never a browser or stored suggested
price. Any changed record or ratecard between primary reads is rejected.

The output state is `preview-only` with purpose
`internal-corrected-proposal-draft`; it contains no approval, public send
action or customer proposal and has no writes. Its draft snapshot checksum is
a **consistency fingerprint only**, not proof of historic permissions, a
commercial signature, or authorization to retry an uncertain transaction.

This does not modify the existing original-extraction proposal reader:
the legacy `readAuthorizedProposalDraftPreview` remains unable to consume
records with corrected scope. Any subsequent signed, customer-visible
proposal requires its own fresh atomic authorization and final human approval.
Real two-user Supabase Auth/PostgREST/RLS/private original Storage, retained
signed malware scanning, company ratecard approvals, privacy/legal/security,
and operational release gates remain open.

The adversarial staged test suite proves a full synthetic correction,
activation and reviewed-scope lineage; corrected costs and optional consent;
rejection of unreviewed, forged, changed or cross-tenant sources; source/policy
changes between reads; lost membership; no writes; deterministic snapshot
fingerprints; and explicit denial by the original proposal reader.

## Legacy original-extraction guard

The legacy `readServiceReviewContext` and
`readAuthorizedProposalDraftPreview` now explicitly refuse an original
extraction row with a non-null pending correction, activated correction, or
corrected-scope review, even if an old `scopeReview` was mistakenly restored.
The original scoped record checksum includes nullable correction lifecycle
columns so a change between authorized reads cannot be ignored. Property
descriptors are inspected without invoking getter-backed state or treating
inherited lifecycle directives as absent. Null optional database columns
remain valid for genuinely uncorrected records. Staged regression tests
cover each forbidden field, changes during the two-read boundary, and the
normal original-extraction preview.

This denial prevents routing corrected evidence through older internal
preview paths; it does not replace live source ownership checks, grant any
send rights, or constitute a production RLS validation.

The legacy human scope and its read-only recovery now use the *same exported*
`serviceReviewFingerprint` for compare-and-swap, so nullable correction fields
cannot create inconsistent fingerprints across modules. The reconciliation
reader classifies newly present correction lifecycle evidence as `conflict`,
including state inserted between the two authorized reads. This is neither
proof of rollback nor permission to retry a previously uncertain mutation.

## Shared bounded inert-data validation of both proposal draft readers

Both internal original-extraction and corrected-proposal preview readers now
use the same `lib/inert-evidence-graph.ts` bounded deep check of
both separately authorized source read-backs **before** calling the
correction-lineage verifier or `JSON.stringify` for its revision-bound
consistency fingerprint. Plain/null-prototype objects and ordinary dense
arrays of JSON scalar values are supported. It denies getter-backed
properties, hidden or symbol directives, custom `toJSON` functions,
unusual prototypes, sparse/decorated arrays, cycles, non-finite numbers,
and overlarge/deep graphs **without invoking untrusted getters or methods**.
Repeated noncyclic references in an in-memory test adapter are allowed.

An unsafe first source read aborts before the approved-policy lookup. This
applies to the original-extraction reader too: neither an old scope review
nor a corrected review can reach proposal calculation through unsafe
stored data. Reusing one pure guard prevents divergent interpretations of
canonical serialized evidence. An
unsafe second source read aborts rather than confirming a stale or malicious
corrected review. Regression cases cover both stages, including corrected
scope acknowledgements, extraction audit, original candidates, and nested
human correction lineage. This remains an internal `preview-only` integrity
check: source-store tenant authorization, immutable SQL/Storage evidence,
session revocation, reviewer permission and proposal approval are separate
live acceptance requirements.

## Async read-back mutation isolation

Both original and corrected proposal readers now call the common
`snapshotInertEvidence` helper on **each** authorized source response,
immediately after the awaited store read and before any subsequent awaited
company-policy lookup. It validates the complete bounded data-only graph,
then uses a detached `structuredClone` snapshot for provenance checks,
review receipts, calculated lines and exact-revision fingerprints.
If cloning fails, the same unsafe-evidence rejection applies.

Previously, a shared mutable adapter object could be changed **after**
passing inert-data preflight during an asynchronous policy lookup. New
regressions inject a getter into the raw returned scope on the first
policy read, and into the raw source text on the second policy read.
Both previews must continue using the original authorized immutable
snapshots and never execute the late getters. These tests protect the
in-process asynchronous boundary only; the second independent
`readAuthorized` and the live tenant/session/RLS validation gates are
still mandatory. This does **not** create proposal approval, sending
authorization, or a commercial signature.


## Company policy read-back validation

Both internal draft preview readers now validate and detach **each** authorized
company-policy history response before inspecting active revision, rates, review
actors or stored policy SHA. The shared preflight rejects accessor-backed,
hidden/symbol, sparse, cyclic or serializer-bearing history fields before
calling the existing policy validator or pricing engine. The policy-specific
bounded snapshot allows up to 1000 history entries (the current history
schema maximum), while the stricter original-source evidence limit remains
unchanged. Graphs above the resource budget fail closed.

Staged regression tests inject malicious rate and history getters, custom
serializers and non-enumerable/symbol approval fields into the first or second
policy read; no hostile getter/serializer executes and no draft is returned.
Company history is still required to come from separately authorized tenant
reads. This is not approval, quote authority or a live Supabase acceptance.
