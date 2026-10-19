# Item 4 — Authorized extraction review commit boundary

This internal **server-only** module bridges the previous source-owned intake
contract to a **persisted, human-review-only extraction snapshot**. It does not
provide a public HTTP route or an AI-provider connection.

`lib/tenant-extraction-service.ts` defines a `TrustedExtractionStore` whose
production implementation must perform source ownership, verified-session
membership, `extract` permission, and an optimistic revision/snapshot CAS
**within one durable database write transaction**. This interface is a
contract; the integration is not implemented against live Supabase.

`readExtractionPreparation` returns an authenticated revision and SHA-256
snapshot for an existing typed note or already-confirmed transcript. Uncertain
audio and transcripts not durably committed remain ineligible. On commit,
`commitAuthorizedExtraction` reloads the **stored** original under the same
write transaction, checks exact source revision and checksum, parses the raw
untrusted extraction response with strict code/quantity/UTF-16 span bounds,
rejects model-supplied pricing, approvals and instructions, and stores only
an immutable human review snapshot with server-derived extraction operator ID.
It rejects duplicate extraction against an unchanged source. The result is
`needs-human-review`, not an approved service, signed authorization or
sendable quote.

As with transcript correction, the adapter must return the exact proposed
transition and then support a **fresh authorized primary/linearizable read-back**
of the stored source and audit. If read-back fails the write outcome is
indeterminate, **not** automatically rolled back, and must be reconciled through
trusted backend evidence; never blindly retry or send a customer proposal.

The resulting persisted record has the same core `organizationId`,
`sourceId`, `revision`, `original`, `review` shape expected by the
existing tenant workbench and preview path. A human still must select each
service and explicitly acknowledge optional add-ons against **active approved**
company pricing. SHA-256 markers are merely consistency evidence, not
authentication signatures.

No live Auth, RLS, private Storage, antivirus, retention, API, uploads,
payments or outbound sending are enabled. Item 3's genuine multiuser
Supabase security acceptance and approval are still mandatory before merge.


## Shared original and review lifecycle consistency

The extraction store now reuses the **same** original-source validator as the
review/preview path. It denies unexpected original fields, NUL, or unpaired
surrogates before it can process text. A missing review is not equivalent to an
explicit null review. A source with no committed review cannot contain an
extraction audit or completed scope decision. An extracted source must have a
single actor-provenance audit whose source/candidate hashes match a complete
validated review of ALL candidates, with a plausible source revision.

The preparation-to-commit consistency marker now covers any creation audit
and reviewed scope carried by the tenant source record. This prevents
unrelated source lifecycle changes from being ignored by optimistic CAS.
These checks are **defense-in-depth**, not a replacement for a trusted DB
transaction, real RLS, or original-byte Auth verification.


## Staged PostgreSQL extraction CAS primitive

`db/typed_note_extraction_commit.sql` provides the private
`bm_intake_private.commit_typed_note_extraction` operation, callable only
by the trusted service role. This is a **candidate SQL component**, not
a production migration or a connected `TrustedExtractionStore`.

The SQL function takes tenant, server-authenticated actor, source UUID,
expected ORIGINAL text SHA-256 and the prepared extraction review. It checks
current membership **before source existence**, locks the membership and
source rows, requires the **original note uploader** (until explicit reviewer
delegation is implemented), and performs exactly one 1→2 CAS. It computes
the typed-note source SHA-256 from stored bytes including the required NUL
separator, checks the review shape, source and kind, bounded candidate types,
and persists a database-authored actor/revision/digest audit. Rejected,
duplicate, revoked or cross-tenant transitions do not update the record.
This function cannot send, quote, approve, upload, or edit original evidence.

**Layered provenance validation:** PostgreSQL now independently checks
each candidate's excerpt against the immutable original using JavaScript's
**UTF-16 code-unit offsets** (including two code units for non-BMP emoji)
through a private `matches_typed_note_utf16_excerpt` function. Half-surrogate
boundaries, out-of-source spans and fabricated excerpts fail before the
revision 1→2 CAS. This complements JavaScript's existing source/excerpt
checks. **Updated defense in depth:** PostgreSQL now independently recomputes
the *canonical candidates-array SHA-256* using the exact ordered JavaScript
candidate tuple representation, including Unicode and JSON escapes, via the
private `bm_intake_private.canonical_candidate_sha256` function. The 1→2
commit rejects forged digest values and changed service quantities before
writing. This is not a substitute for server Auth: **browser or raw AI JSON
must never be sent directly to the function**. The staged server
adapter `createTrustedTypedNoteExtraction` must receive fresh verified
Supabase Auth, read the stored original from primary storage, call
`parseUntrustedExtraction` to recompute canonical candidate hashes, then
pass only the validated review through parameterized SQL. It must perform
fresh authorized primary read-back; ambiguous commits remain **indeterminate**
and are never retried blindly. Genuine provider wiring and two-user live
security acceptance are still outstanding. Same-tenant noncreators cannot
extract another member's private typed note with this staged function.

The `intake-db` Actions job installs the candidate SQL after the prior
source/ledger/lookup suites and executes `ci/db_intake_extraction_test.sql`.
It checks positive original/audit preservation and adverse cases including
foreign tenant, same-tenant other actor, missing source, wrong source hash,
hidden approval/pricing fields, stale duplicate and post-revocation denial.
All tests run on a disposable PostgreSQL instance, not live Supabase.
Item 3's Auth/Storage/ClamAV/retention/security acceptance remains mandatory;
there is no customer-facing route or approval to deploy.


## Verified-original service bridge (staging only)

`db/typed_note_extraction_read.sql` adds a private
`bm_intake_private.read_typed_note_for_extraction` projection. The
service-role-only, SECURITY INVOKER SQL checks and locks current membership
before considering source existence, restricts the result to the original
creator, and returns all eight current typed-note evidence fields, including
the immutable original and creation audit. Revoked actors are denied for
both existing and missing sources; other same-tenant actors receive no
private original. It is neither a public RPC nor a deployed migration.

`lib/trusted-typed-note-extraction.ts` composes this read, the existing
private `commit_typed_note_extraction` SQL and independently verified
server Auth identities. It rejects client actor IDs, obtains the original
from creator-scoped primary storage, validates its creation audit and
SHA-256, parses *all* untrusted candidates with
`parseUntrustedExtraction` (exact JavaScript UTF-16 source excerpts and
canonical candidate digest), then rechecks fresh Auth and issues one
parameterized 1→2 CAS. The service must supply its own **genuine**
non-revoked session verifier and primary service-role PostgreSQL driver.
No such real connection has been configured.

The adapter requires exact CAS acknowledgement and a new independently
authenticated private read to confirm revision, immutable original, complete
review and database-authored actor evidence. Failed post-CAS verification
means **indeterminate commit**, never permission to retry or to approve a
quote. It returns only `needs-human-review`, with no route to send,
publish, price, bill or accept an unsupported service.

Mocked regression cases in
`tests-web/trusted-typed-note-extraction.test.mjs` cover Unicode UTF-16
spans, tampered/price-bearing extractor suggestions, duplicate extraction,
same-tenant and foreign denial, revocation and actor switches between reads,
untrusted SQL confirmations and provider failures. The real isolated
PostgreSQL CI job also executes
`ci/db_intake_extraction_read_test.sql` for private read projection,
creator ownership, tenant isolation and revoked membership. These are
staged tests only, not real session provider acceptance.

Before live integration, Item 3 must deliver approved Auth/Storage/RLS
two-user evidence, maintained ClamAV, abuse limits, recovery/retention,
privacy/legal/security signoff and configuration of a protected primary
database connection. There is no customer route or production migration.


## Executable JavaScript-to-PostgreSQL contract proof

`ci/intake_extraction_bridge.test.mjs` runs the **actual**
`createTrustedTypedNoteExtraction` JavaScript adapter end-to-end against
the **actual** staged private Postgres read and CAS functions within the
disposable `intake-db` GitHub Actions service. Unlike separately mocked
JS tests and SQL-only cases, it compares the canonical Unicode UTF-16
candidate digests, recorded server actor, returned review, and primary
read-back across both languages and through the full adapter.

The CI-only database shim runs narrowly allowlisted private queries using
`psql`'s literal-quoting fixture variables, with ephemeral credentials
and synthetic source/actor data. It is **not** a reusable or production
driver; production must use parameterized SQL over a protected primary
connection. The independently injected CI Auth verifier is also synthetic
and **not** evidence that real Supabase sessions are valid.

The bridge tests successful extraction, stale replay refusal, foreign-
tenant and same-tenant other-user isolation, revocation of underlying
membership after source read, loss of synthetic Auth between read and CAS,
and attempts to insert model-origin price or false original offsets. The
required `intake-db` job provisions Node 24 and executes these assertions
after all SQL fixture setup. No empty/skipped check substitutes for this.
No public customer route, live Auth, deployed migration or payment/send
feature is enabled by the new bridge proof.


## Read-only reconciliation after an uncertain extraction CAS

`createTrustedTypedNoteExtraction(...).reconcile(input)` is an
internal-only recovery inspection for the case where the private 1→2
extraction CAS could have committed but its response or authorized read-back
was lost. It accepts the **same original** source selector and bounded raw
extraction response; it never creates a request ID, issues CAS, retries,
prices, approves, sends, or publishes.

It executes **two independent freshly authenticated creator-scoped primary
reads**, validates the complete typed-note lifecycle on each read, parses
the expected model candidates only against the persisted immutable original
(including UTF-16 exact excerpt spans and canonical candidates checksum),
and compares the complete consecutive records. It reports only:

- `matching-extraction-at-read`: both reads observe the exact parsed
  review and server-authored extraction actor, at revision 2 or 3; this
  is a **matching stored snapshot**, not proof that this specific
  ambiguous attempt was the writer, and never an approval.
- `unprocessed-at-read`: both reads observe revision 1. This is **not**
  proof of transaction rollback or absence of an in-flight commit.
- `changed-during-read`: source/evidence changed between observations.
- `different-extraction-at-read`: a stable advanced source contains
  other reviewed evidence; the caller must not reinterpret it as its own
  operation.

Any denied/missing source, revoked session, changed Auth actor, invalid
provenance, primary DB outage or malformed record **throws**, not a
fabricated negative or successful reconciliation. None of these statuses
authorizes blind retry; restart and subsequent human workflow decisions
need their own trusted server-owned coordination and current source/policy
checks. The adapter is still staging-only, with injected synthetic Auth
and isolated private PostgreSQL proof, not real Supabase acceptance.

Mocked adversarial Node tests cover each read-only outcome, revocation
between reads, forged candidate text and racing source changes. The
`intake-db` job also tests **actual JS reconciliation against actual
PostgreSQL** after deliberately dropping an already-committed SQL response,
then proves there was exactly one CAS and two subsequent read queries.


## PostgreSQL UTF-16 source/excerpt enforcement

`ci/db_intake_utf16_provenance_test.sql` is part of the required
disposable PostgreSQL `intake-db` job, in addition to the existing Node
and JavaScript-to-SQL bridge tests. It independently proves that a
valid emoji span (`6..8` UTF-16 units for `🧱`) and a word following
that emoji are accepted, while forged excerpts, codepoint-versus-code-unit
offset confusion, surrogate-pair split boundaries and very large offsets
are rejected with no change to the original source. Anonymous and
authenticated browser roles cannot execute the private validator.

This does not implement provider authentication, approved company policy
revision checks or the candidate-array digest inside SQL. It does not
authorize a user to approve a proposal, send a message, or initiate billing.


## Canonical candidate checksum independently enforced in PostgreSQL

`db/typed_note_candidates_digest.sql` constructs the same JSON string
as `lib/intake-review.ts`'s `candidatesDigest`: ordered arrays of
`[serviceCode,units,start,end,excerpt]` with canonical integral numbers
and JSON-escaped text. The private service-only function hashes the UTF-8
bytes using SHA-256. It does not hash JSONB object serialization or rely
on source object key ordering. It refuses unknown candidate fields, unsafe
integer counts, missing candidates and malformed shapes.

`db/typed_note_extraction_commit.sql` compares the independently computed
digest with the submitted review digest **after** checking the immutable
original and exact source excerpts and **before** the database transition.
The required ephemeral PostgreSQL `intake-db` job installs the digest
function before the CAS, then executes
`ci/db_intake_digest_test.sql` with independently calculated JavaScript
SHA vectors for simple text, emoji and escaped quotes/newlines/backslashes.
Existing extraction SQL cases now use canonical fixture digests and assert
that both a forged digest and a changed service count with a stale digest
fail without mutating source evidence. The actual JavaScript-to-PostgreSQL
bridge remains in CI for cross-language confirmation.

**Scope:** This reduces reliance on the trusted adapter for checksum
integrity, but the server must still verify current Supabase Auth, current
tenant membership and private source access, and must validate model inputs.
No real customer-facing route or provider migration is enabled.


## Real concurrent extraction CAS and audit isolation

The disposable PostgreSQL `intake-db` job now runs
`ci/intake_extraction_concurrency.test.mjs` using **independent
`psql` processes** that concurrently invoke the real private
`commit_typed_note_extraction` function against the *same* newly created
tenant-owned source. This covers database races that sequential mock tests
cannot reproduce. It verifies:

- Eight concurrent identical authorized extraction attempts result in exactly
  **one** successful revision 1→2 commit and seven explicit stale/replay
  failures, never an apparently successful duplicate.
- Four writers racing to submit two **different** valid, source-exact
  extraction snapshots likewise produce one winner and preserve the
  **whole** winning review, single database-authored actor audit and
  matching canonical candidate SHA-256. No interleaved partial reviews,
  duplicate audit records, or changes to immutable original text are allowed.

All actors, notes and memberships are synthetic; each case receives a fresh
request/source. These tests require the real database function's row locks,
revision guard and append-only audit and run in addition to the preexisting
source, digest, UTF-16, membership/revocation, and JS-to-SQL integration
suites. They are **not** a substitute for production concurrent-load
testing or genuine two-user Supabase Auth/PostgREST/RLS/Storage evidence.
There is still no customer-facing intake, proposal approval or send route.


## Staged PostgreSQL human service-review draft transaction

`db/typed_note_scope_review_commit.sql` is a **private, service-role-only
staged** primitive for source revision 2→3. It persists a deliberately
non-sendable `reviewed-for-proposal-draft` decision after a human's
server-verified selection. It checks current membership **before source
existence**, locks that membership and the source row, and restricts this
initial version to the original typed-note creator. A later reviewer
delegation mechanism must be explicitly approved and tested, not assumed.

The database validates the immutable original's source SHA-256, the stored
candidate-array canonical SHA-256, the prior revision 2 extraction audit,
the exact allowed 11 review-decision fields and the reviewer actor ID.
Selected indices must be nonempty, sorted, unique, within bounds and
must not select the same service code twice. Optional acknowledgements
must name unique selected codes. Extra prices, approval flags, client
actors, nonexistent sources, foreign tenants, revoked members, duplicate
decisions and invalid source hashes are rejected without modifying the
original text, extraction review or extraction audit.

**Critical deployment limit:** Subsequent staged changes add a locked
approved-policy table/head and independently recompute the review
workbench and selected-service fingerprints in the same private CAS.
The server still MUST authenticate actual participants, verify the
complete approved commercial policy, and connect the current provider
through the trusted interface. Item 3's real Auth/RLS/Storage security
acceptance has NOT occurred. This draft SQL primitive is **not safe for
live review routes**, cannot issue quote approval and must remain unexposed.

The existing real `intake-db` GitHub Actions job installs this primitive
after the staged extraction and concurrency suites, then runs
`ci/db_intake_scope_review_test.sql`. This verifies the one-way
revision 2→3 transition, unchanged original and extraction audit,
restricted original creator, same-tenant and cross-tenant denial,
nonexistent source, forged client controls, malformed selection, replay
refusal and post-revocation denial against disposable PostgreSQL. No
production migrations, pricing authorization, sending or billing are
created.


## Staged approved-policy activation and locked scope binding

`db/staged_policy_activation.sql` adds two private tables in
`bm_intake_private`: append-only `approved_policy_versions` and one
current `active_policy_heads` pointer per tenant. Anonymous and ordinary
authenticated database roles have **no table access**. The private
`activate_scope_policy` function requires an active tenant submitter
(owner/operator/contractor) and **another distinct active owner/operator**
reviewer, both membership rows locked, a sequential policy revision,
bounded server-serialized JSON, required pricing minimum/order and service
definitions, and a real PostgreSQL SHA-256 over the supplied policy bytes.
It never fabricates a contractor's approval or default rate. Historical
approved versions reject UPDATE and DELETE. A separate PostgreSQL trigger
rejects direct active-head deletion, rollback, and revision skipping, even
when an older approved snapshot remains stored. Authorized sequential
activation advances the locked head by exactly one revision.

The existing private `commit_typed_note_scope_review` now locks the
current policy-head row and referenced immutable approved version **inside
the same transaction as the source revision 2→3 CAS**. With no approved
tenant policy, the review fails closed. If policy revision or SHA differs
from the approved active snapshot, the review is stale and cannot commit.
Each selected code must belong to that ratecard, have `charged` or
`included` (not `pending`) billing, and not appear in the company
exclusions. Optional company services require the human's distinct
acknowledgement; acknowledging an ordinary service as an add-on fails.
Missing billing and malformed optional fields also fail closed. Policy
activation and scope CAS hold conflicting PostgreSQL row locks, preventing
activation from silently overtaking the review CAS within its transaction.

The disposable `intake-db` job installs the approved policy structures
before the scope CAS and runs
`ci/db_intake_active_policy_test.sql` after the existing scope tests.
The positive fixtures are explicitly **synthetic company policy examples**
with two distinct synthetic members. They test pending-service refusal,
self-approval and nonmember reviewer denial, stale policy revisions,
optional-add-on enforcement, activation of a newer company ratecard and
immutable historical version rejection.

**Nonproduction trust limits:** The activation API still relies on a
trusted server to authenticate the two *real* people and run the full
`company-policy-revisions.ts` commercial-policy validation. The SQL
records a digest of server-provided serialized policy text; it cannot by
itself prove that text follows the JavaScript canonical serializer or
constitutes an actual signed human approval. The scope CAS now also independently reconstructs and checks the
`reviewKey` and `reviewedSelectionSha256` against stored source
evidence and the locked active policy. No production policy-approval
adapter is connected,
no live Supabase multiuser proof has passed, and no customer-facing
review, pricing approval, sending or billing is enabled. Review outputs
are only `reviewed-for-proposal-draft`, never approvals or sendable
quotes. Completing those integrations requires Item 3 security
acceptance and independent, current approved-policy evidence.


## Shared TypeScript policy fingerprint and actual PostgreSQL bridge

Item 4 now uses `lib/company-policy-fingerprint.ts` for both historical
approval revision hashes (`company-policy-revisions.ts`) and never-sendable
quote preview `policySha256` (`company-economics.ts`). Previously one path
sorted keys using JavaScript's code-unit order, while another used
`localeCompare`; equivalent policies could have different digests. The
shared serializer recursively orders object keys by deterministic Unicode
code-unit order and rejects unsafe numbers, non-JSON values, forbidden
prototype-related keys, excess nesting and oversized policy text. It emits
the **exact UTF-8 canonical policy bytes** required by private PostgreSQL
`activate_scope_policy`, not just a caller-supplied checksum.

The required `intake-db` CI job now also runs
`ci/intake_policy_fingerprint_bridge.test.mjs`. It uses the *real*
TypeScript `submitPolicyDraft` + independent `reviewPolicyDraft` +
`readActivePolicy` domain, computes canonical policy bytes, activates
them through actual private PostgreSQL, and asserts that approved history,
the active database row, economics preview and a subsequent human
`reviewed-for-proposal-draft` decision all carry exactly the same SHA.
The test also verifies real immutable typed-note extraction, UTF-16
provenance, optional add-on acknowledgment, unchanged stored original
and singular database-authored extraction audit.

**Limitations:** The integration employs synthetic actors and a disposable
PostgreSQL service role. It is a cross-language contract proof, **not** a
connected production approval adapter, authenticated two-human signature,
genuine Supabase Auth/RLS test or a verified company price list. The
database now independently recomputes the workbench `reviewKey`
and ordered selected-service fingerprint, but it cannot prove that a
browser-supplied session belongs to the server-verifying human. Item 3
security and real-provider acceptance remain mandatory before creating
customer-facing routes, approving proposals, enabling sends or merging.


## Database recomputation of selected review evidence

`db/typed_note_review_fingerprint.sql` implements two service-role-only
PostgreSQL functions. `review_workbench_sha256` reconstructs the exact
JavaScript review-key JSON tuple of the immutable source hash, candidate
array hash and current approved policy SHA-256. `reviewed_selection_sha256`
reconstructs the ordered `selectedServices` objects with the exact
`serviceCode`, `units`, `start`, `end` and optional
`addonAccepted: true` fields. It computes the SHA-256 of the same
source/candidate/selected-services/policy JSON tuple as
`previewReviewedEconomics`. Both are calculated from the **stored**
candidate list and active policy, not from a client-provided review key.

The private `commit_typed_note_scope_review` source revision 2→3 CAS now
rejects mismatched hashes after current membership, creator, immutable
original/extraction audit, selected-index, active-policy and optional
acknowledgement checks. The `intake-db` gate runs actual PostgreSQL
tests with canonical fixture fingerprints and a TypeScript-to-PostgreSQL
bridge proving byte-for-byte agreement. It separately rejects forged
review keys and selection hashes without changing the source revision.

**Remaining:** Fingerprints are consistency evidence, not digital signatures,
authenticated review consent or pricing approval. Live two-person
Supabase Auth verification, production approved-policy adapter, RLS,
private Storage, real anti-malware checks and security/privacy/legal
acceptance are still mandatory; no sendable quote is produced.


## Read-only recovery for an uncertain human-review commit

`db/typed_note_scope_inspect.sql` stages a **private, service-role-only
primary PostgreSQL read** called
`bm_intake_private.inspect_typed_note_scope_commit`. A trusted backend
must independently verify the live session before supplying the actor
identity. The function rejects unauthorized, revoked, foreign-tenant or
same-tenant noncreator access before disclosing whether a source exists.
It locks current membership and source rows for the duration of the read,
recomputes the immutable original/candidate hashes and validates the
extraction audit. For a persisted revision 3 it also verifies **both**
review fingerprints against the historical immutable approved policy
version, then checks whether the policy is still the active head.

The read returns exactly one of these **point-in-time observations**, never
an authorization decision:

- `unreviewed-at-read`: source remains revision 2 with no persisted
  human-review draft, **not proof of rollback** or permission to retry.
- `matching-scope-at-read`: a persisted revision 3 has the expected
  selection fingerprint and is bound to the currently active policy;
  **not proof the caller's particular lost request created it**.
- `different-scope-at-read`: the persisted, independently validated
  selection fingerprint is different; no retry or overwrite.
- `matching-stale-policy-at-read`: historical evidence matches, but a
  newer policy is active; the review is **not a current pricing authority**.

Invalid/modified evidence and revoked authorization throw instead of
returning reassuring classifications. There is no write, no CAS retry,
no approval, no customer send and no implicit promotion from an audit
snapshot to an approved quote. Two fresh, separately authorized reads
can provide additional recovery evidence, but still cannot prove the
history of an ambiguous acknowledgement or prevent a later change.

`ci/intake_policy_fingerprint_bridge.test.mjs` now exercises this
private read against real disposable PostgreSQL before and after the
actual TypeScript→SQL scope review, including two matching reads after
simulating a lost acknowledgement, a different selection, a subsequent
approved policy revision, foreign/noncreator denial and revoked
membership. It verifies the function is unavailable to the ordinary
authenticated role and never changes the persisted extraction audit.
The `intake-db` CI job installs the read function and executes these
cases without weakening any existing gate.

This remains a staged recovery contract, **not** a connected real
Supabase Auth, authorization, policy approval or provider read adapter.
Item 3 two-user live isolation and the organization's privacy, security,
retention and incident-recovery acceptance remain mandatory.


## Two-read server-side scope recovery adapter

`lib/trusted-typed-note-scope-recovery.ts` adds the matching
`createTrustedTypedNoteScopeRecovery(auth, database).reconcile(...)`
integration *contract* above the private PostgreSQL inspection function.
The caller supplies the same kinds of externally verified
`ActiveSessionVerifier` and privileged primary
`PrivateIntakeDatabase` ports as typed-note extraction. This module
does **not** implement or bypass real Supabase Auth and never opens
PostgREST/browser SQL connections.

It validates an exact tenant/source/source-SHA/candidates-SHA/expected
selection-SHA selector, authenticates the opaque session freshly before
**each** of two independent private primary reads, and confirms the
user ID has not changed between observations. The SQL function itself
then rechecks current tenant membership and source creator ownership
before source existence, validates original/evidence, and compares
historical approved policy with current head. If either read fails,
membership is revoked, the actor changes, a database response is
malformed/contradictory, or there is any other uncertainty, the adapter
fails closed. If the independently verified read-time classifications,
revisions or stored hashes differ, it returns only
`changed-during-read`; otherwise it returns the matching point-in-time
SQL observation.

No response can mean the initial lost-acknowledgement attempt was the
writer, that no future competing transaction can commit, that retries
are safe, or that an approved/current price exists. This is **never**
a write transaction, automatic retry, quote approval or customer send.

`tests-web/trusted-typed-note-scope-recovery.test.mjs` verifies
fresh per-read Auth, true two-read matching/unreviewed/different/stale
classifications, changes between observations, contradictory and
malformed driver replies, invalid selectors, actor switching,
revoked sessions and second-read errors. The actual disposable
PostgreSQL `ci/intake_policy_fingerprint_bridge.test.mjs` also invokes
the new TypeScript adapter over the real private SQL and checks
matching/different/stale results, denied noncreator identity and
membership revocation. These are synthetic primary-database tests, not
live end-to-end security acceptance.
