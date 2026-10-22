# Item 6 — Isolated SQLite transaction rehearsal (no external actions)

**Status: CI-only fictional fixture. Item 6 H01–H13 remain UNVERIFIED; release blocked.**

## Purpose and boundaries

`ci/item6_sqlite_rehearsal.py` models a small part of the future H08/H09
transaction contract using temporary SQLite files and invented `.example`,
`.test`, or `.invalid` addresses only. It lives in `ci/` and has no Next
route, customer database, Supabase connection, email, token issuance, provider
API, or actual delivery operation. The `dryrun_` key is only an untrusted
identifier, not an authenticated authorization or proof of approval. It
cannot grant contact permission. It can be tested on Linux and Windows with
Python's standard library, without credentials or external connectivity.

A new isolated fixture is created exclusively under the operating system's
temporary directory and refuses pre-existing files, symlink paths and real
recipient domains. The fixture is deleted by its enclosing test's temporary
directory context. The model accepts **fictional caller data**, not verified
provider events, consent, buyer identity or operator approvals. It has no
queue worker or `sent` state. In particular, it never claims to solve the
**provider accepted request vs database commit** crash boundary, message
idempotency across a real provider, PostgreSQL row locking, tenant RLS or
recoverability after a disaster. Passing tests cannot close H08/H09.

## Rules exercised

| Concern | Offline demonstration | Required live evidence still missing |
| --- | --- | --- |
| One reservation per tenant/recipient | `BEGIN IMMEDIATE` and a partial unique index allow one current fictional lock across independent connections | PostgreSQL transaction, actual RLS, exact current approved revision and real provider idempotency |
| Same idempotency key | `(organization_id,idempotency_key)` unique primary key blocks replay even after invalidation | Trusted key material, persisted provider request/response correlation and crash recovery |
| Reply/opt-out/bounce/complaint | Immutable signal rows immediately invalidate simulated recipient reservations in one transaction, across proposals | Verified events, consent source and durable stop-contact enforcement at worker send boundary |
| Won/lost closure | Immutable proposal-wide terminal claim invalidates all same-proposal reservations, across recipients and revisions | Authenticated CRM events and transactional recheck of deal outcome before real send |
| Tenant separation | Every SQL lookup and update is scoped by organization | Auth session ownership, RLS denial and test-tenant evidence in real PostgreSQL |
| Rollback/races | Explicit commit/rollback, independent concurrent SQLite connections, replay and adversarial tests | PostgreSQL concurrency, isolation/deadlocks, retries, queue outage and provider crash simulation |

`tests/test_item6_sqlite_rehearsal.py` is discovered by the existing
non-optional `ci/tests.py` suite, which runs in Linux `fast`, `pr`, `security`
and Windows `win-fast`; no gate has been removed. Run locally with
`python -m unittest -v tests.test_item6_sqlite_rehearsal`.

**Next production implementation requires separate explicit authority** to
operate on the chosen authenticated staging tenant and sender sandbox. Build
PostgreSQL migrations with reviewed RLS, exact immutable revision approvals,
recipient consent proof, verified signed provider callbacks, atomic outbox
reservation/rechecks and independently tested recovery; only then collect
H01–H13 evidence in the existing release inventory. Never connect this
SQLite simulation to the app or interpret `reserved-simulation-only` as a
ready-to-send verdict.


## Uncertain provider-handoff recovery rehearsal — fictional only

A crash after a provider request begins but before its result is durably
recorded is **not** safely equivalent to "never sent." The isolated SQLite
fixture now models this ambiguous boundary without contacting any provider.
A previously reserved fictional row can transition exactly once to
outcome_unknown using mark_fictional_handoff_unknown; a second claim
returns a blocked/no-op verdict. This state survives process restart and
blocks a new dry-run reservation for the same tenant and recipient, even for
a different proposal. The original tenant/key uniqueness remains intact,
and the partial unique active-recipient index now covers **both** reserved
and outcome_unknown. There is **no** method to send, mark delivered,
release uncertainty, or automatically retry.

Later caller-provided reply/opt-out/bounce/complaint or won/lost events
invalidate only unattempted reserved rows, never retroactively reclassify
outcome_unknown into an unsent or delivered event. Stop-contact and
closure conditions still block future fictional reservations. The
read-only fictional_unknown_count returns only a per-tenant aggregate,
not recipient, proposal or key information. Eight additional Python
negative/recovery tests cover exact claim identity, subprocess restart,
same/other proposal conflicts, contact and terminal-deal signals,
22 concurrent claimants, opposing racing mutations, tenant isolation,
and process exit without a database commit. They run through the existing
required ci/tests.py discovery in Linux fast/pr/security and Windows;
no existing CI or release threshold is changed.

**Do not equate this with an outbox or real crash recovery.** There is no
real provider, delivery attempt, signed provider receipt, durable
PostgreSQL RLS, authenticated user/tenant, approved revision, verified
consent or independent evidence. Production must separately resolve an
uncertain send with the selected provider's authenticated idempotency and
status APIs, log/reconcile ambiguous outcomes, and test crashes at every
actual DB/provider boundary. A fictional rollback/restart test does not
prove H07/H08/H09/H11; H01–H13 all remain unverified and release blocked.
