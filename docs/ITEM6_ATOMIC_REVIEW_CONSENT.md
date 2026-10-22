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

This is **not verification of actual consent or approval**: any caller can fabricate these local records. It has **no authenticated reviewer identity, real policy authority, immutable actual document, actual subscriber, event signatures, RLS, private storage, provider, queue worker, buyer portal, or SQL/PostgreSQL staging database**. An invented SHA-256 string is not proof the bytes were approved. The low-level synthetic reservation API remains available only inside isolated tests and therefore must **not** be connected to real sending. Its low-level unknown-handoff helper now also **refuses every reviewed reservation**, returning `blocked-reviewed-reservation-use-strict-handoff` instead of bypassing the stricter reviewed-handoff checks. Only `mark_reviewed_fictional_handoff_unknown` can convert such a claim to the sticky `outcome_unknown` state after repeating revision, review, consent, and exact-recipient confirmation checks inside its own transaction. A missing/deleted confirmation cannot be bypassed by calling the legacy helper; legacy unreviewed fixture behavior is preserved for its isolated tests. No `contactAuthorized` or `releaseAuthorized` result is exposed.

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

## Exact recipient confirmation (fictional, Item 6 continuation)

General recipient consent, two exact-revision review receipts, and contractor permission to deliver **this revision to this recipient** are three different claims. Previously the offline SQLite gate could reserve an internally reviewed proposal for any invented recipient with a tenant-wide fictional consent record, even if no actor acknowledged the chosen proposal/recipient pairing. The disposable fixture now stores a **separate** `rehearsal_recipient_confirmations` event keyed to tenant, proposal, revision and recipient, with the exact content SHA-256 and the same fabricated contractor actor as the review receipt. The event ID is unique per tenant, and a conflicting replay is rejected. Neither customer consent nor company review is inferred from this event.

`record_fictional_recipient_confirmation` checks fabricated contractor review, content hash, current revision, invented consent and contact/closed-deal holds in one SQLite transaction. `reserve_reviewed_fictional` refuses any missing or mismatched exact-recipient confirmation. The same reusable check applies before the separate **unknown-handoff rehearsal**; an old confirmation cannot unlock a superseding revision, another fictional proposal or another recipient. Known opt-outs, other contact stops and closed deals take priority over missing paperwork. Reconciliation of `outcome_unknown` remains a **manual held state**, not a retry or permission to send.

The new negative tests cover a missing recipient confirmation despite valid consent and review, incorrect actor/content, replay and event identity collision, scope separation between recipients/proposals/versions, late revisions, and contact stops. These are invented claims in throwaway SQLite files with `*.example` recipients, **not proof of authenticated human approval, independent real recipient consent, actual provider delivery or production Postgres/RLS**. All H01–H13 external requirements remain unverified; no new endpoint or sender has been enabled. Treat earlier reported 53/53 local SQLite checks as historical only, not as verification of this new branch head; inspect its Actions results before reporting a pass.

## Revoking a fictional recipient confirmation

A previously recorded invented contractor recipient confirmation now has a
**sticky, independently keyed revocation** in the disposable SQLite fixture.
`revoke_fictional_recipient_confirmation` requires the exact invented tenant,
proposal, revision and recipient. It checks that the confirmation exists,
stores a tenant-unique revocation event identity, and atomically invalidates
**pending reviewed** reservations for that exact scope in one
`BEGIN IMMEDIATE` transaction. Replays of the same revocation are idempotently
blocked; different events for the same scope and cross-recipient event reuse
fail closed. Unrelated recipients remain independent.

Both the strict fictional reservation and the strict reviewed handoff now read
that revocation and return `blocked-recipient-confirmation-revoked`. The
original confirmation cannot be re-recorded to revive the revoked scope.
Critically, any `outcome_unknown` claim remains held for reconciliation:
revocation cannot prove that an uncertain external side effect did not occur.
The isolated legacy handoff still cannot bypass reviewed claims.

Adversarial tests cover already-pending reservations, recipient separation,
event collisions and replay, reservation-vs-revocation transactions, and
revocation after an uncertain handoff. These are **caller-fabricated, CI-only**
fixtures and cannot establish a real authenticated revocation, unsubscribe,
customer preference, provider cancellation or buyer identity. There is no live
PostgreSQL migration, provider integration, sending endpoint or release
permission. All H01–H13 external requirements remain unverified.

## Fictional contact-consent withdrawal

The invented per-recipient contractor delivery confirmation and the **separate**
invented tenant/recipient contact-consent record are not interchangeable.
The disposable SQLite test fixture now models a **sticky contact-consent
withdrawal**, distinct from the permanent bounce/complaint/opt-out suppression
signal. `revoke_fictional_consent` requires an already recorded fabricated
consent confirmation and an independently unique withdrawal event ID. An exact
replay is blocked; a conflicting replay or event-ID collision fails closed.

The withdrawal records only the fictional **organization + recipient** scope
and atomically invalidates all pending `reserved` rows for that recipient
across *all proposals* under the same fictional organization. It does not
affect a different organization or recipient, and it never erases any
`outcome_unknown` row because an uncertain external handoff requires
reconciliation. The original consent cannot be replayed to restore permission.
The shared low-level SQLite CAS, strict review gate, recipient confirmation
recorder, and reviewed handoff all reject withdrawn consent; the legacy
handoff is still prohibited for any reviewed claim. Existing opt-out/complaint/
bounce contact stops retain priority over consent-withdrawal holds.

The new tests cover withdrawal before/after a fictional reviewed handoff,
cross-proposal blocking, event replay and event-ID collisions, an opt-out's
stronger priority, simultaneous reservation/withdrawal, and low-level CAS
bypass prevention. The fixture intentionally contains only reserved-domain
fabricated recipient addresses; this **does not** represent authenticated
customer permission, live unsubscribe processing, an auditable permission
source, or a PostgreSQL migration. The state is conservative: no re-consent
flow exists, and no real provider or sending operation was enabled. All
H01–H13 real external and human gates remain outstanding.

## Redacted fictional hold snapshot

`ci/item6_sqlite_hold_summary.py` adds an **offline, read-only**
`fictional_hold_summary` for exercising operator reconciliation visibility.
It queries the existing disposable SQLite fixture in one `BEGIN IMMEDIATE`
transaction and requires an exact fabricated tenant UUID. Every count is
restricted to that tenant. The returned shape deliberately contains **no
tenant ID, recipient address, proposal ID, reviewer, event ID, raw message,
contact fingerprint, idempotency key, or provider claim**:

- `pendingReservations` and `invalidatedReservations`: local reservation
  rows by state, not actual dispatched or cancelled messages.
- `unknownOutcomeHolds`: unresolved simulated handoffs requiring manual
  external reconciliation; these are *not* delivered-message counts.
- `consentWithdrawals`: invented recipient-level withdrawal records.
- `recipientConfirmationRevocations`: invented per-recipient/revision
  contractor approval revocations, not the same scope as consent.
- `suppressedRecipients`: backward-compatible **distinct union** of
  fictional recipients with *any* stop or reply contact signal; this legacy
  label does not mean every recipient has permanently opted out.
- `hardStopRecipients`: **distinct** fictional recipients with one or more
  opt-out, bounce or complaint signals. Multiple hard-stop signals for the
  same recipient count once, even when a reply also exists.
- `replyOnlyReviewRecipients`: **distinct** fictional recipients with a
  reply signal but **no** opt-out, bounce or complaint. Manual review is
  required; a reply is **not** itself a permanent opt-out. Once a hard stop
  is recorded for the same tenant and recipient, priority shifts them to
  `hardStopRecipients` instead of double-counting.
- `rawPendingReservations` and `reviewedPendingReservations` split the
  total local `pendingReservations` into **unreviewed CAS fixture** rows
  and rows with revision-bound internal reviews. Neither category represents
  a message to be sent or proof of recipient permission.
- `closedProposals`: fictional won/lost proposal closure records.

The output always has `state="review-simulation-only"` and
`contactAuthorized=false`. The contact-hold split is intentionally
disjoint **within this fixture**: `hardStopRecipients +
replyOnlyReviewRecipients = suppressedRecipients`; it does not establish
real-world permission, consent or deliverability. Similarly,
`rawPendingReservations + reviewedPendingReservations =
pendingReservations`. Other categories may overlap, so their totals
**must not** be added to derive a number of unique customers. The fictional
operator view neither clears `outcome_unknown` nor issues approvals,
tokens, notifications, reconsents or sends.

Seven mandatory Python test cases cover the empty safe shape, tenant isolation,
distinct suppression recipients, overlapping unknown-outcome/withdrawal holds,
revoked confirmations and terminal closures, concurrent snapshot consistency,
and bad fixture/tenant inputs. This is not an authenticated operator dashboard,
a production Postgres/RLS query or proof of live provider events. H01–H13
external and human release holds remain outstanding.

 
### Fail-closed fictional pending-evidence consistency

The aggregate snapshot also reports **`inconsistentPendingReservations`**
and a **`pendingEvidenceState`** that is either
`consistent-simulation-only` or `inconsistent-needs-review`. These fields
are distinct from the delivery counts. They flag **currently pending**
fictional reservations that contradict the same-tenant state: recorded
contact-stop or consent-withdrawal events, a terminal proposal closure, or
(for **reviewed** reservations only) missing or mismatched independent
operator/contractor revision receipts, a newer partial review, missing
recipient consent, missing contractor-exact-recipient confirmation, or
confirmation revocation. Tests for manually corrupted temporary fixtures
demonstrate detection rather than falsely presenting a healthy count.

Raw *unreviewed* CAS fixture rows deliberately do not need reviewer receipts:
the raw fixture remains an isolated transaction test, not permission to
contact. An **already unknown** outcome may legitimately coexist with later
opt-out/withdrawal/closure and is not counted as a corrupted *pending* row.
Only counts are returned; individual identity or evidence details remain
redacted. The checker never updates rows, releases holds, infers actual
customer consent, or asserts that even a "consistent" fictional reservation
would be safe to send. This is **not** a live database integrity monitor.

## Low-level handoff and withdrawn fictional consent

In addition to the strict reviewed reservation/handoff gates, the legacy
`mark_fictional_handoff_unknown` now independently checks the **recipient's
fictional consent-withdrawal ledger** before attempting its raw reservation
transition. Previously a pending raw CAS fixture row restored or corrupted
after a withdrawal could move to `outcome_unknown` because the legacy
handoff checked only contact signals and deal closures. Normal withdrawal
still atomically invalidates pending work, while this independent check
protects the **handoff boundary even when fixture state is inconsistent**.

The check is tenant-and-recipient scoped, does not require or fabricate a
reviewer for an intentionally unreviewed raw CAS fixture, and does not
change an already uncertain outcome. Four adversarial regression tests
cover normal invalidation, a deliberately restored corrupted pending row
(flagged by the read-only hold summary), isolation between fictional
tenants, and competing legacy handoff and withdrawal transactions. These
are disposable offline state-machine tests only; no actual provider handoff,
customer consent, authenticated revocation, send, or release authority
has been implemented. H01–H13 remain unverified.
