# Item 6 — Atomic fictional approval and consent gate

**CI-only rehearsal. No sender, provider, tenant authentication, or customer data.** All H01–H13 production acceptance evidence remains **unverified**, and release remains blocked.

## What changed

The earlier SQLite exercise in `ci/item6_sqlite_rehearsal.py` intentionally tested raw transactional recipient locks, suppression, closure, and uncertain handoffs using **fabricated** identities, but did not model review and consent prerequisites. That raw `reserve_fictional` entry point remains a **low-level transaction test helper**, *not* an operational delivery API and never proof of permission.

The new separate `ci/item6_sqlite_review_gate.py` offers a stricter **offline-only** rehearsal: `reserve_reviewed_fictional` checks the required records and runs the shared `_reserve_in_transaction` CAS in a **single `BEGIN IMMEDIATE` transaction**. The same disposable SQLite fixture gains two invented-evidence tables: `rehearsal_review_receipts` and `rehearsal_consent_confirmations`.

The gate refuses reservations unless:

1. The exact tenant/proposal/revision has an **operator** and **contractor** review with two different invented actor UUIDs; their exact lowercase SHA-256 content hashes must match the candidate.
2. No newer partially or fully reviewed revision exists for the same tenant/proposal. Even an uncompleted newer revision freezes the older revision in this rehearsal.
3. A fictional consent confirmation exists for that tenant and invented recipient. A duplicate event is idempotent; conflicting event IDs or different recipients sharing an event ID are rejected.
4. The original transaction-level recipient/tenant/key deduplication, permanent reply/opt-out/bounce/complaint hold, and won/lost deal-closure constraints still pass immediately before the database insert.

The test model rejects invalid revisions, noncanonical hashes, duplicate review roles, an actor trying to approve both roles, forged/changed receipt identities, and non-fictional addresses. The review-recording transaction also refuses a late receipt for an older revision after any newer review has begun, and rejects the second reviewer's contradictory content SHA **before persisting it**. Two concurrent reviewers presenting distinct SHA values cannot create a mismatched pair; the matching review can be retried with the original SHA. Reservation still independently rejects wrong content and incomplete review, including unexpected historical/corrupted fixture state. A fictional contact stop recorded later blocks reservations; a closed deal blocks new review claims and reservations. All tests use temporary databases and fabricated identities, without network, customer accounts or emails.

## Verification and limitations

`tests/test_item6_sqlite_review_gate.py` now contains **13** adversarial regression groups, including independent connection races against stop-contact and terminal-deal closure, concurrent different-hash reviewers, and stale receipts after partial supersession. The original review/consent checkpoint had 47 SQLite tests; these later regressions must be verified on their own exact Actions commit. It is discovered by existing required Linux/Windows Python CI jobs; no test gate is relaxed.

This is **not verification of actual consent or approval**: any caller can fabricate these local records. It has **no authenticated reviewer identity, real policy authority, immutable actual document, actual subscriber, event signatures, RLS, private storage, provider, queue worker, buyer portal, or SQL/PostgreSQL staging database**. An invented SHA-256 string is not proof the bytes were approved. The low-level synthetic reservation API remains available only inside isolated tests and therefore must **not** be connected to real sending. No `contactAuthorized` or `releaseAuthorized` result is exposed.

Before building a real endpoint or marking any H01–H13 source as verified, staging needs authenticated tenant-scoped RLS, actual immutable revision/document evidence, independently approved company/policy and two distinct authenticated reviewer receipts, verifiable recipient consent, signed provider events, durable outbox/idempotency with external crash reconciliation, negative live safety tests, and independent security/privacy/legal/operational human go/no-go. Preserve the current draft PR and release hold until that evidence exists.

## Superseding an earlier reviewed reservation (fictional)

A newer proposal review previously blocked *new attempts* against the older
revision but did not cancel an older reservation already present in the
disposable SQLite fixture. That old `reserved` row could subsequently be
marked as a fictional handoff even after a newer partially reviewed revision
existed. The model now stores nullable `reviewed_revision` and
`reviewed_sha256` fields alongside each reservation. The strict reviewed
entry point binds these values in its existing transaction; the original
low-level test helper intentionally stores NULL because it has **no trusted
review** and must never be used as an app dispatch implementation.

Inside the *same BEGIN IMMEDIATE transaction* that records a new fictional
review receipt, every pending **reviewed** reservation of an earlier revision
for the **same tenant and proposal** becomes `invalidated`. This applies
even when the newer revision has only an operator receipt. The historical
idempotency key remains reserved and cannot be reused with a changed
reviewed revision or content hash; once the new revision has both invented
reviews and invented consent, it can obtain a **new simulation-only
reservation** without resurrecting the old claim. Unrelated proposals,
tenants and legacy low-level test rows are unaffected.

Critically, `outcome_unknown` is **never** invalidated by a newer review:
the fictional handoff might already represent an external side effect.
That recipient remains locked for reconciliation. Races between recording a
new review and reserving the old revision serialize inside SQLite. A
separate set of six adversarial test groups reproduced **four failures**
against the prior code and now passes; the existing test expectation for
a fully reviewed newer revision was updated to require the safe transition.
Prior supersession checkpoint: **53/53 passing** locally, before the subsequent review-recording consistency tests. Do not substitute that historical result for current-head CI. Mandatory CI gates
and release-evidence requirements are unchanged.

This is a disposable SQLite rehearsal, not a real versioned approval ledger,
real provider cancellation, real buyer consent or a production database.
No code here authorizes sending. All H01–H13 independent release requirements
remain UNVERIFIED and `releaseState=blocked`; PR #15 stays draft.

## Same-transaction pre-handoff review and consent recheck (fictional)

The stricter `reserve_reviewed_fictional` already required two distinct
invented reviewers, an exact revision/content digest, a fabricated consent
event, and an unlocked recipient **at reservation time**. The older low-level
fixture function `mark_fictional_handoff_unknown` did not recheck these
prerequisites **at handoff time**. The isolated review gate now exposes
`mark_reviewed_fictional_handoff_unknown`, a fail-closed test-only state
transition that never calls a provider, sends or authorizes a message.

Inside one temporary SQLite `BEGIN IMMEDIATE` transaction the new helper
requires the exact tenant/key/proposal/recipient and stored reviewed
revision/hash, a still-active reviewed reservation, no newer partially
reviewed revision, two distinct matching fictional reviewer receipts,
persisted fictional consent, no recipient stop-contact signal and no
terminal-deal closure. A low-level *unreviewed* test reservation cannot
pass the stricter handoff. Already `outcome_unknown` handoffs remain
unknown rather than being retried or cleared. It shares the existing
atomic review predicate with the reservation preflight to avoid drift.

Eight new adversarial groups cover absent or unreviewed reservations,
immutable identity and content, deleted or modified fictional receipts,
newer revisions, recipient opt-out/closure, restart-safe unknown replay,
and competing revision-review/handoff transitions. The test started red
before the helper existed; after reconciliation with the separately
committed review-recording validation, the full local **95/95 Python test
discovery passed**, including **61/61 SQLite tests** on that local tree.

**This remains a fabricated, non-sending CI-only model.** Passing a mock
handoff check cannot establish actual customer consent, verified identity,
immutable production document bytes, authenticated reviewers, a real email
provider, real database transactions, or provider crash recovery. Live
integration must separately enforce authenticated, server-owned checks
at the actual send boundary. All **H01–H13 release requirements remain
unverified**; `releaseState=blocked`, and PR #15 remains draft.
