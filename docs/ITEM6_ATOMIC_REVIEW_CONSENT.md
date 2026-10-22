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

The test model rejects invalid revisions, noncanonical hashes, duplicate review roles, an actor trying to approve both roles, forged/changed receipt identities, and non-fictional addresses. A fictional contact stop recorded later blocks reservations; a closed deal blocks new review claims and reservations. All tests use temporary databases and fabricated identities, without network, customer accounts or emails.

## Verification and limitations

`tests/test_item6_sqlite_review_gate.py` adds **11** adversarial regression groups, including two independent connection races against stop-contact and terminal-deal closure. The full targeted SQLite suite currently contains **47 tests** and passes locally. It is discovered by existing required Linux/Windows Python CI jobs; no test gate is relaxed.

This is **not verification of actual consent or approval**: any caller can fabricate these local records. It has **no authenticated reviewer identity, real policy authority, immutable actual document, actual subscriber, event signatures, RLS, private storage, provider, queue worker, buyer portal, or SQL/PostgreSQL staging database**. An invented SHA-256 string is not proof the bytes were approved. The low-level synthetic reservation API remains available only inside isolated tests and therefore must **not** be connected to real sending. No `contactAuthorized` or `releaseAuthorized` result is exposed.

Before building a real endpoint or marking any H01–H13 source as verified, staging needs authenticated tenant-scoped RLS, actual immutable revision/document evidence, independently approved company/policy and two distinct authenticated reviewer receipts, verifiable recipient consent, signed provider events, durable outbox/idempotency with external crash reconciliation, negative live safety tests, and independent security/privacy/legal/operational human go/no-go. Preserve the current draft PR and release hold until that evidence exists.
