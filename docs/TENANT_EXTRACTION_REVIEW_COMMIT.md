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


## Trusted server-only scope commit adapter (staged, no public route)

`lib/trusted-typed-note-scope-commit.ts` now connects the existing
human-review workbench and deterministic economics preview to the
**real private PostgreSQL 2→3 scope CAS** through two explicitly
injected, trusted ports: `ActiveSessionVerifier` and
`PrivateIntakeDatabase`. It accepts only an opaque session, tenant,
source, review key, sorted selected indices and acknowledged optional
service codes. Clients cannot provide the actor ID, company policy,
service prices, approval state, or send directives.

Before attempting the **single SQL write**, the adapter verifies a
fresh authenticated identity, reloads the original creator-owned source
from primary PostgreSQL, validates the full immutable extraction and
creation audit, and reads the current approved policy head and immutable
approved version using the privileged private port. It confirms the
policy JSON has the **same canonical SHA-256** as the stored active head
and that the two synthetic approval actors are distinct. The existing
workbench and preview independently revalidate source-exact candidates,
the current review key, selected service eligibility and add-on consent.
Another fresh authenticated identity check immediately precedes the
single `commit_typed_note_scope_review` private CAS, whose PostgreSQL
implementation independently verifies current membership, creator
ownership, stored source evidence, locked approved policy revision,
selected optional services and both review fingerprints.

A successful database response is **not sufficient**. The adapter
performs a separate freshly authorized primary source read-back,
requires revision 3 with the exact full expected review snapshot and
unchanged original/extraction audit, then checks current approval
policy revision/SHA again under fresh authorization. If Auth changes,
the policy advances or the read-back diverges, the operation fails
closed. A database exception or lost response after invoking CAS is
**indeterminate, not rollback**: the adapter does not retry the
write and cannot return an approved or sendable quote. Callers can use
the already-staged, independently authorized read-only scope recovery
adapter to inspect point-in-time evidence, but not to authorize retries.

`tests-web/trusted-typed-note-scope-commit.test.mjs` covers the
expected private query sequence, fresh Auth checkpoints, hostile and
unsorted selections, ineligible and unacknowledged optional services,
changed/revoked identity, forged/stale policy and review key, lost
acknowledgements and post-write stale policy/readback tampering.
`ci/intake_scope_commit_bridge.test.mjs` runs the real TypeScript
adapter through **actual disposable PostgreSQL**: synthetic members,
two-person staged policy activation, immutable typed-note extraction,
a correct scope CAS, duplicate refusal, forged key, noncreator denial,
membership revocation and simulated lost-acknowledgement persistence.
The existing mandatory eight-job CI matrix and all prior gates stay
enabled.

**Unresolved release boundary:** This is **not** a connected production
Supabase Auth/provider, an authenticated real two-person commercial
approval, or real PostgREST/RLS/Storage acceptance. The PostgreSQL
integration uses synthetic actors and a nonproduction service role.
Connecting and exposing the workflow requires all outstanding Item 3
security tests and privacy/security/legal approvals, and a separately
verified live company policy. No customer route, quote approval, billing
or external send is present.


## Revocation-safe privileged active-policy reads

The server-only `createTrustedTypedNoteScopeCommit` adapter now reads
the active approved company policy through a **membership-bound SQL SELECT**
instead of an unrestricted privileged service-role lookup. The read joins
`public.bm_memberships` on the freshly authenticated actor, organization
and permitted current role, and locks the membership, active policy head
and immutable policy version with `FOR SHARE` for that statement. This
applies to **both** the initial active-policy read and the final read
after the single 2→3 CAS and authorized source read-back.

Previously, the source read and the CAS checked current membership, but
revocation *after* the source read-back could be missed by the final
privileged policy check. Now the final policy lookup returns no record
when membership has been revoked, so the adapter **fails closed** rather
than reporting an authorized completed draft. The earlier CAS may
already have committed; that result is indeterminate and does **not**
authorize a second write, automatic rollback, approval, or send.

`tests-web/trusted-typed-note-scope-commit.test.mjs` simulates a
revocation precisely between authorized source read-back and final
privileged policy lookup, and confirms exactly one write and a rejected
success response. `ci/intake_scope_commit_bridge.test.mjs` verifies
the same timing against real disposable PostgreSQL, tests direct
nonmember and revoked-user policy lookups, and asserts both policy
reads use the authorized actor and membership-locked query. Existing
mandatory CI gates remain unchanged.

This is a staged service-role contract, **not** real two-user Supabase
Auth or live tenant policy approval. Membership must still be
authoritatively maintained, production service keys must remain
server-held, and Item 3 live RLS, private Storage, antivirus, recovery,
privacy/legal and security acceptance remain outstanding.


## Concurrent review CAS and approved-policy head races

The existing mandatory disposable PostgreSQL `intake-db` job additionally
runs `ci/intake_scope_concurrency.test.mjs`, which starts **independent
`psql` operating-system processes**, not sequential unit-test mocks:

1. Eight valid requests commit the same human review against one original
   revision 2 source. Exactly one may advance to revision 3; all seven
   losers must fail with an explicit stale/replay error.
2. Six valid requests compete with **different** selected services and
   optional acknowledgements. Exactly one complete reviewed-scope
   snapshot, matching its own selected-service SHA-256, can persist.
   Original typed-note text, creation/request identifiers, immutable
   candidate review, text SHA and single extraction audit remain intact.
3. A separate two-member-approved pricing activation from revision 1
   to revision 2 races a scope CAS pinned to revision 1. The successful
   activation must advance the policy head to revision 2. The scope CAS
   may commit only while revision 1 is still the locked active head,
   leaving a **historically valid but now stale** reviewed draft, or
   it must reject revision 1 as stale or temporarily unavailable
   with **no source update**. Under PostgreSQL `READ COMMITTED`, a joined
   `FOR SHARE` read racing a policy-head UPDATE can legitimately report
   no current approved policy rather than the explicit stale-policy
   mismatch. Both are fail-closed rejections. It must never commit a
   revision 1 review after observing revision 2.

These tests use real PostgreSQL membership/source/head row locks and
immutable policy version references, in addition to the existing
sequential positive/negative SQL, cross-language fingerprint, fresh-Auth
adapter, and recovery regressions. They do not weaken any of the eight
CI jobs, and they do not simulate live session, production storage,
provider failures, policy-review signatures or human consent.
A previously persisted review is **not** a current quote merely because
its transaction succeeded while an earlier ratecard was active. Sending,
approval, retry and billing remain disabled.


## Independent PostgreSQL commercial-policy validation

`db/staged_policy_activation.sql` now independently rejects company ratecard
economics that the approved-policy TypeScript model already disallows but
the earlier database shape checker could accept. In addition to current
two-distinct-member authorization, immutable policy history and the
monotonic active-head transaction, the private SQL activation enforces:

- A nonblank company policy ID; `minimum.rule = none` requires zero
  minimum cents and `tax.method = none` requires zero tax basis points.
- Each service's optional `surchargeBps`/`discountBps` must be a
  nonnegative integer within 0–10,000, including pending and included
  services. Invalid JSON types, fractions and out-of-range values fail.
- `excludedServiceCodes`, if present, must be an array of distinct
  strings identifying services actually listed in the approved policy.
- `unitDirectCostsCents`, if present, must be a JSON object with
  existing service codes and nonnegative whole-cent values bounded to
  JavaScript's maximum safe integer. Required minimum and service rates
  are likewise checked against the safe-integer ceiling.
- An invalid approval attempt cannot create an approved version,
  advance the active pricing head or rewrite prior immutable history.

The mandatory real disposable `intake-db` job now executes
`ci/db_intake_policy_economics_test.sql` after the existing active
two-actor ratecard tests. It submits a deliberately malformed first
policy for each invalid commercial field, checks the absence of any
approved policy record/head, activates a valid synthetic example, and
proves a malformed successor cannot replace it.

This is a **defense-in-depth commercial data-integrity check**, not
evidence of an approved contractor ratecard or real tax-law settings.
The database does not validate live Supabase sessions or actual
two-person pricing consent; approved pricing and sends remain disabled
until the Item 3 real-provider/security gates are satisfied.


## Creation/audit identity pinning during scope read-back

The private creator-owned typed-note source contract now checks that the
persisted `extractionAudit[0].actorId` equals BOTH the verified source
creator and the immutable `creationAudit.actorId`, in addition to the
original and candidate hashes. A correct digest cannot authorize an
extraction attributed to a different person.

After the one-shot private human scope CAS, the trusted server adapter
also compares the entire original `creationAudit` against its previously
read snapshot, alongside the original text, extraction review and
extraction audit. A post-CAS change to the source request ID or creation
receipt (even when internally self-consistent and formatted as a UUID)
is treated as **indeterminate**: the adapter does not report a successful
review, repeat the write or approve a quote.

The existing `tenant-typed-note-source` unit suite now includes a
forged extraction-actor record with otherwise valid source/candidate
digests; the `trusted-typed-note-scope-commit` suite mutates the
post-write creation request ID and proves the success claim is denied
after exactly one write. The mandatory CI matrix remains intact.
These are additional verification checks, not a replacement for Item 3
live authenticated tenant isolation and server-owned immutable storage.


## Historical policy eligibility on recovery (fingerprints are not consent)

The private `db/typed_note_review_fingerprint.sql` now exports
`bm_intake_private.matches_approved_scope_services`, a shared
service-role-only, immutable PostgreSQL validator used by both the
revision 2→3 human scope CAS **and** read-only revision 3 recovery.
It checks sorted, in-range selected candidate indices, unique selected
service codes, supported `charged`/`included` billing, tenant policy
exclusions, exact approved `optionalAddon` consent and no unselected
or duplicate acknowledgements. Neither caller-supplied hashes nor
a validly structured selected-service fingerprint proves these rules.

For durable revision 3 reads, `db/typed_note_scope_inspect.sql` now
loads the actual immutable **historical approved policy JSON**, not just
its SHA-256, and independently rechecks selected service eligibility
before classifying any read as matching, different, or stale. This
preserves the meaning of a stored review after a newer ratecard becomes
active, but refuses to legitimize corrupt historical service choices.
The live CAS uses the same helper rather than a separate eligibility
implementation, reducing policy rule drift.

`ci/intake_policy_fingerprint_bridge.test.mjs` now simulates a hostile
**privileged direct PostgreSQL UPDATE** of a separate revision 2 source
to a revision 3 scope that has a valid source hash, canonical
candidate hash, exact review key, valid selection SHA and approved policy
revision. The selected service is nevertheless either `pending` or
an optional service without separate consent. The isolated private
reconciliation must reject both as invalid historical policy evidence.
Each hostile write runs in a rollback-only transaction; a valid optional
service with explicit consent is the positive control. This proves
recovery does not turn a structurally correct checksum into an
approval, billing right or verified consent.

**Still not production approval:** The test uses synthetic two-person
approval and disposable PostgreSQL. It cannot validate actual user
signatures, live Supabase Auth/RLS/Storage, antivirus or organizational
policy ownership. No public route, customer send or billing is enabled.


## Trusted two-person approved-policy activation bridge (staged)

`lib/trusted-company-policy-activation.ts` closes the former adapter gap
between `company-policy-revisions.ts`/the durable
`TrustedPolicyStore` read contract and private
`bm_intake_private.activate_scope_policy` in PostgreSQL. The adapter
accepts **only** an organization ID and opaque reviewer session:
there are **no** client-provided rates, policy object, actor IDs,
approval flag, revision or checksum. The trusted store must have
previously persisted an independently submitted-and-reviewed immutable
policy history through its own authorization and CAS mechanism. The
activation adapter does **not** create that review or claim a human
approval merely because the client supplied a session.

The activation sequence:

1. Freshly authenticate the reviewer; freshly authorize the exact
   organization's *durable* history through `TrustedPolicyStore`.
   Recompute/validate every immutable revision, active head, actors,
   policy shape and canonical SHA-256. Require the current last revision
   to be **approved by this same authenticated, distinct reviewer**.
   Reject draft/rejected/noncontiguous history.
2. Re-authenticate and read the current private PostgreSQL policy head
   through a membership-bound, row-locked query; compare its revision
   and SHA against the last already activated version. An absent head
   is valid only for a first revision.
3. Re-authenticate and call exactly **one** private
   `activate_scope_policy` with *server-computed* canonical JSON bytes.
   SQL independently checks and locks current submitter/reviewer
   membership, roles and head, validates economics, and writes immutable
   approved history and the next head atomically.
4. After the write, perform another independent freshly authenticated
   authorized store read and current membership-bound primary
   PostgreSQL read-back. The approved revision, SHA, canonical policy,
   original submitter and reviewer must all match. An ambiguous result,
   changed reviewer or policy, revoked membership or lost acknowledgement
   **fails closed**. There is never an automatic retry or assumption
   that an exception means rollback.

The only success result is
`activated-for-internal-review` with a revision and policy SHA,
**not** an approved proposal, customer send, billing or deployed
production ratecard. The adapter still needs a genuine provider-backed
`TrustedPolicyStore`, live Supabase Auth verification, appropriate
separate approval records and real tenant/RLS/Storage/security
acceptance. Two synthetic members or a forged in-memory history are
not an actual independently consented policy approval.

`tests-web/trusted-company-policy-activation.test.mjs` verifies
fresh reviewer checks, immutable histories, one-write semantics,
replays, rejected/self-reviewed/forged policies, changed or revoked
sessions, historical and database read-back integrity and lost
acknowledgements. The existing mandatory disposable `intake-db`
gate now executes `ci/intake_policy_activation_bridge.test.mjs` with
real PostgreSQL membership locks and versioned policy activation,
checking successful version 1 and 2, replay denial, authenticated
reviewer mismatch, DB membership revocation and a durable version 3
when the provider's acknowledgement is deliberately lost. Nothing is
merged or enabled for customers by these tests.


## Append-only durable policy submission and review ledger (staged)

`db/staged_policy_review_history.sql` introduces a **durable,
tenant-scoped PostgreSQL policy-review history** for Item 4, rather than
relying only on an injected/in-memory `TrustedPolicyStore` mock. This
remains a non-deployed private staging contract. Separate private event
tables store immutable submitted canonical policy snapshots and **independent
review decisions** (approval or rejection); a monotonic submission head
holds the latest submitted revision and checksum. Draft and decision
events cannot be rewritten; the private functions are unavailable to
browser `anon`/`authenticated` roles. PostgreSQL enforces the
current submitter's tenant membership and a distinct current authorized
owner/operator reviewer, including revocation. A rejected version still
occupies a revision, and a new submission requires the previous version
to be reviewed.

The private functions
`submit_policy_history_draft(org,actor,expectedRevision,expectedSha,canonicalPolicy)`,
`review_policy_history_draft(org,actor,revision,expectedSha,decision)`, and
`read_policy_history(org,actor)` provide one-revision compare-and-swap,
separate human decision recording and a membership-checked, coherent
`PolicyHistory` snapshot. Transaction-scoped per-organization advisory
locking serializes **first-ever concurrent submissions** as well as
subsequent drafts and decisions. Both event tables are append-only
and the head can only progress by one. The immutable reviewed record
contains the actual reviewer ID, not an assertion embedded in a
client-supplied policy object. The read shape is checked against the
existing TypeScript `PolicyHistory` domain, which retains exact
versioned policy SHA and active-approved semantics.

Mandatory isolated `intake-db` now installs this ledger and runs
`ci/intake_policy_durable_history.test.mjs`, exercising a real initial
draft, distinct approver, prohibition on self-review and duplicate
decisions, rejected policy followed by later draft, retained latest
approved version, denied nonmember/revoked access, immutable events,
no browser EXECUTE grants and **six separate PostgreSQL processes
racing the same initial draft**, requiring exactly one success. Direct
event deletion is denied at the privilege layer (and changes granted
by service role remain subject to append-only triggers).

**Remaining nonwaivable integration:** The earlier
`createTrustedCompanyPolicyActivation` still accepts a
`TrustedPolicyStore` interface. The persisted ledger is staged as
a primary-database foundation; it is **not yet a deployed adapter
for that interface**. The SQL functions take actor UUIDs that must
ultimately be derived from fresh real Supabase Auth by a server,
not supplied by a browser. Nor does the event ledger alone establish
human consent or validate a real company's service rates. Until
that verified provider integration and all Item 3 tenant security,
private Storage, antivirus, privacy/legal and recovery acceptance,
the activation remains unavailable to customers and cannot authorize
a sendable quote.


## Primary PostgreSQL TrustedPolicyStore adapter (staged)

`lib/trusted-postgres-policy-store.ts` now implements the exact
`TrustedPolicyStore` port used by `submitCompanyPolicyDraft`,
`reviewCompanyPolicyDraft`, `previewAuthorizedReviewedEconomics`, and
`createTrustedCompanyPolicyActivation`. The implementation depends on
a freshly verified `ActiveSessionVerifier` and server-held
`PrivateIntakeDatabase` primary connection; it does **not** define
live Supabase credentials, a public RPC or a customer route.

For every read, the adapter verifies the opaque session anew and executes
`bm_intake_private.read_policy_history` with the authenticated actor.
It validates the exact history/revision record shape and runs
`assertValidCompanyPolicyHistory` even when no policy has yet been
approved. An absent policy history returns null only after current
membership checks in PostgreSQL; revoked or foreign actors are denied.

For a mutation, the adapter treats its callback as **untrusted**.
It supplies a copy of the current history and the freshly authenticated
actor, then reconstructs the ONLY permissible submitted-draft or
reviewed-draft transition with `submitPolicyDraft` or
`reviewPolicyDraft`. It requires exact structural equality, preventing
the callback from inventing a reviewer, decision, earlier revision,
ratecard or active head. It reauthenticates immediately before one
privileged PostgreSQL append-only submission/review CAS. Database
functions again lock and authorize current membership and the
submission head. After writing, it performs another fresh authorized
history read, and returns only if the **entire** persisted history
equals the validated expected transition. A changed identity, stale
head, corrupted response or lost acknowledgement is an indeterminate
failure, **never an automatic retry**.

The mandatory `intake-db` gate now runs
`ci/intake_policy_store_bridge.test.mjs` against real disposable
PostgreSQL and the actual TypeScript policy-service operations.
Coverage includes initial draft, independent approval, activation of
the resulting durable approved policy, rejected successor retaining
the previous active version, a later draft, malicious callback,
self-review, stale head, outsider/revoked member, and post-write
revocation or simulated lost acknowledgement with no replay.

**Remaining boundary:** This is a valid stage-to-primary adapter,
not live browser/authenticated proof of two distinct human decisions.
The injected verifier and database driver still need genuine
Supabase session validation, tenant-specific service-role isolation,
production approval authorization, audit/recovery controls and Item 3
security/privacy/legal acceptance. No customer-facing approval,
quote sending or billing is enabled.


## Activation after explicitly rejected policy submissions

The durable `TrustedPolicyStore` keeps every submitted policy revision,
including separately reviewed **rejections**. Previously, the staged
activation adapter and SQL only accepted sequential *approved* revision
numbers, so an approved third submission could not become active after
a legitimately rejected second submission.

`lib/trusted-company-policy-activation.ts` now identifies the last
**approved** history revision (rather than the immediately preceding
submitted revision) and requires every intervening submission to be an
explicit `rejected` decision. The private
`bm_intake_private.approved_policy_gap_is_reviewed` function in
`db/staged_policy_review_history.sql` independently verifies each
intervening immutable draft/decision event and requires an exact approved
target matching the canonical policy SHA-256, submitter and distinct
reviewer. `db/staged_policy_activation.sql` retains its current
membership and economics checks, locks the approved head, and allows a
nonconsecutive activation **only** with this immutable evidence. First
activation at revision 2 is possible only when revision 1 has an actual
durable rejection and revision 2 has its own independently approved
event. A skipped, pending or missing decision remains a hard failure.

The head trigger continues to deny rollbacks and unproven jumps,
including direct updates. Initial head validation uses an **AFTER
INSERT** trigger, because `INSERT ... ON CONFLICT DO UPDATE` invokes
`BEFORE INSERT` even for updates; using a before-insert check would
incorrectly reject a verified advancement of an existing head. The
per-organization transaction advisory lock serializes activation with
the durable reviewer ledger. The mandatory `intake-db` workflow installs
that ledger immediately after the policy tables and **before** the
first policy-activation test, so validation never runs without its
supporting private function.

The real `ci/intake_policy_store_bridge.test.mjs` adds both workflows:
approved 1 → rejected 2 → approved 3, and rejected 1 → first
approved 2. It rejects activating v3 before the rejection and before
the target's distinct approval, proves rejected versions never appear
as activated approvals, and ensures repeat activation is denied.
All existing contiguous two-actor activation, tenant isolation,
source-review CAS and concurrency gates remain enabled.

This remains **staging only**; a synthetic reviewer decision is not
independent commercial consent or live Supabase approval. No public
route, pricing publication, customer send or billing is enabled.


## Read-only company-policy activation reconciliation after unknown outcomes

`lib/trusted-company-policy-recovery.ts` now provides a separate
**server-only, read-only** reconciliation API for a policy activation
whose database acknowledgement may have been lost. Its selector
contains only the tenant, opaque reviewer session, historical
revision and canonical policy SHA; no client-provided actor, service
rates, approval decision, write instruction or retry toggle is accepted.

Each of **two independent observations** freshly authenticates the
reviewer, reads the full authorized `TrustedPolicyStore` immutable
history, requires the requested revision to have been independently
approved by that same reviewer, and reads both the currently active
approved policy and the exact immutable historical activated version
from privileged **primary** PostgreSQL. The SQL queries independently
bind current same-tenant `owner/operator` membership, and the
adapter validates every persisted policy's canonical SHA, revision,
submitter and reviewer against the durable history. It rejects
forged historical versions, an activated pointer missing its
immutable approval, a recorded future activation behind an older
head, missing membership and any inconsistent history.

The only permitted observations are:
- `not-active-at-read`: the requested approved policy was not active
  at the two observed instants; this does **not** prove an earlier
  transaction rolled back or authorize a retry.
- `matching-active-at-read`: the matching immutable approval was
  active at both observation instants; this is **not** a customer
  approval or proof of a particular invocation's authorship.
- `historical-superseded-at-read`: this exact approved revision was
  activated historically, but a subsequently approved revision is
  the current head.
- `changed-during-read`: the independently authorized observations
  saw different head states or checksums; no successful outcome
  may be inferred.

No method executes a write, retries an unknown activation, produces
a quote or authorizes a send. Every result is point-in-time evidence
only. `tests-web/trusted-company-policy-recovery.test.mjs` covers
two-pass observations, authorization, forged historical SHA, session
identity changes, malformed selectors and active-head movement during
the reads. `ci/intake_policy_store_bridge.test.mjs` now exercises
actual isolated PostgreSQL initial approval, unactivated policy,
activated v1, later active v2 with historical v1, membership
revocation, and recovery after an intentionally lost v1 activation
acknowledgement. The PostgreSQL test driver allowlist was expanded
only for the exact new historical **SELECT**, not for any write.

This remains a staged provider-contract integration with synthetic
users. Live Supabase Auth, actual independent human approval,
PostgREST/RLS/private Storage, antivirus, recovery/retention,
privacy/legal and security acceptance under Item 3 are still
mandatory before production exposure.


## Read-only receipt recovery for uncertain policy submissions and reviews

`lib/trusted-company-policy-event-recovery.ts` provides a server-only,
read-only, **two-observation** recovery workflow for the append-only
durable policy submission and independently reviewed decision ledger.
The existing `TrustedPostgresPolicyStore` still executes at most one
private write per submit/review operation and NEVER retries a write
after a lost acknowledgement. This recovery implementation supplies
point-in-time ledger evidence without adding a write path.

The selector accepts only organization UUID, opaque active session,
revision, policy SHA-256, and either `kind: "submission"` or
`kind: "review"` with explicit `decision: "approve" | "reject"`.
The actor is ALWAYS derived from fresh server-side verification,
never supplied by the caller. Every observation uses a separately
authorized `TrustedPolicyStore.readAuthorized` and validates the
**entire** immutable history before looking up its revision.

For submission recovery, an observed matching record must have
the same submitter UUID and canonical SHA-256. Its status may have
progressed from `draft` to `approved` or `rejected`; this is
still the original durable submission receipt, not a new approval.
For review recovery, the adapter independently checks current
`owner/operator` membership using a restricted read-only
PostgreSQL `FOR SHARE` query, including when a review decision
has not yet been recorded. A recorded review must match this
authenticated reviewer's UUID, the exact SHA and the requested
approval/rejection decision. A self-review cannot be treated as
an unrecorded legitimate review.

Two observations of matching identity and evidence return
`matching-record-at-read` or `not-recorded-at-read`, with
`observedStatus` (null, draft, approved or rejected). Different
observations produce `changed-during-read` with no success claim.
Conflicting SHA, wrong submitter or reviewer, permission loss,
bad selector, malformed history, or other ambiguity fails closed.
In particular, **not recorded at two instants is NOT proof that the
original write was rolled back, and NEVER licenses a retry**.

`tests-web/trusted-company-policy-event-recovery.test.mjs` checks
both observations, draft→decision races, wrong reviewer decisions,
forged source SHA, changed session, self-review, revoked reviewer
permission and malformed selectors without SQL writes. The mandatory
real-PostgreSQL `ci/intake_policy_store_bridge.test.mjs` now
simulates separately lost submit and approve acknowledgements
**after durable commits** and confirms recovery reads the correct
immutable receipts while issuing zero additional writes. A real
database membership downgrade from owner to contractor is also
tested: the reviewer can still read ordinary tenant history but
cannot claim independent reviewer privileges in recovery.

These are staging tests with injected synthetic session verification
and disposable PostgreSQL. Genuine Supabase authentication,
independent human signatures, RLS/private evidence, antivirus,
retention/recovery, privacy/legal and security acceptance under
Item 3 remain mandatory. No customer-facing approval, retry,
send, billing or production route is enabled.


## No approval from member UUIDs: all activations require immutable review

The previous staged `activate_scope_policy` validator required an
immutable, independently reviewed policy event only when **skipping**
rejected revisions. For first and adjacent revisions it checked two
current tenant members, but could still accept an unreviewed policy
constructed by a privileged service-role caller. Two syntactically valid
member UUIDs are **not** evidence of independent reviewer consent.

All private company policy activations now require a matching immutable
`policy_draft_events` row and separate approved
`policy_decision_events` row for the **target** revision, exact
canonical policy SHA, actual submitter and distinct actual reviewer.
`approved_policy_gap_is_reviewed` applies to every advancement,
including 0→1 and adjacent versions; nonadjacent advancements additionally
require every skipped version to carry an immutable rejection.
The activation SQL rechecks those records inside the same
per-organization serialized transaction as the membership, economics,
head-lock and immutable approved-version write. Direct head UPDATE or
initial INSERT triggers independently deny pointer mutations without
the same reviewed target evidence, even if the caller inserts an
otherwise valid-looking approved version. Older committed versions
cannot be retroactively rewritten or treated as newly approved.

The existing mandatory `intake-db` test job now installs a **CI-only**
`ci_stage_approved_policy` helper from
`ci/db_policy_approved_fixture.sql` in its disposable database. That
helper calls the actual private submit and review functions with
synthetic, separate tenant members; it is NOT a production migration
or alternate activation path. Existing positive database and
TypeScript bridge tests now stage the corresponding immutable
submission and reviewed decision before activation, rather than
fabricating approval merely from two UUIDs. The new
`ci/db_policy_activation_requires_review_test.sql` tests all
the following denial cases against real PostgreSQL: first activation
with no submission, an unreviewed draft, a different current reviewer,
changed policy bytes, a direct initial head insertion without review,
and a forged adjacent head update without review. Only a target with
the correct recorded independent decision may be activated.

This is staged defense in depth: synthetic CI actors and a service
role do NOT prove genuine commercial approval by separate human users.
Actual provider-backed Supabase Auth, owner/operator eligibility,
private evidence, maintained antivirus, retention, privacy/legal and
security acceptance remain nonwaivable Item 3 gates. No customer
approval, quote send, billing, live endpoint or production deployment
is authorized by these synthetic test results.


## Source-backed internal review workbench and non-sendable pricing preview

The same server-owned `createTrustedTypedNoteScopeCommit` adapter now
exposes **read-only** `readWorkbench({session, organizationId, sourceId})`
and `preview({session, organizationId, sourceId, reviewKey,
selectedIndices, acceptedAddonCodes})` operations. These are staged
server contracts, not public API routes, and they reuse the **exact same
private source / active-policy PostgreSQL reads and validators as the
human scope-commit path**. Browser callers provide no actor ID, raw
source, extracted candidates, price schedule, policy JSON or quote amount.

Both operations freshly verify the creator's active session, read the
creator-owned revision-2 source through
`read_typed_note_for_extraction`, verify the immutable original,
creation audit, UTF-16 candidate provenance and extraction review,
and read the current organization-owned approved pricing revision via
a separate same-tenant, membership-locked active-head JOIN.
They require an extraction still awaiting human review (revision 2,
no `scopeReview`). After computing the workbench or pricing preview,
they perform **another separately authenticated PRIMARY source read
and approved policy read**. Any change in the complete source record
or active policy revision/SHA during those two observations fails
closed and requires refresh.

`readWorkbench` returns an internal-only `ReviewWorkbenchModel`
with row indices, grounded excerpts, policy-relative availability,
pending/excluded/unlisted service statuses and a source/policy-bound
review key. `preview` requires that same key and revalidates sorted
unique selection and explicit optional add-on consent through
`prepareReviewPreviewRequest`, then computes deterministic company
economics solely from the current stored evidence and approved
policy. It returns a `preview-only` result and selection fingerprint:
**no SQL write, signed approval, customer-ready quote, send or billing**.
The independent `commit` operation remains the only staged
creator-owned 2→3 scope CAS and still reauthorizes/reads back its
single write.

`tests-web/trusted-typed-note-scope-commit.test.mjs` adds zero-write
positive previews, forbidden actor/price/source inputs, stale keys,
missing optional acknowledgement, revoked membership, changed
immutable evidence and changed active policy between read passes.
The existing mandatory `intake-db`
`ci/intake_scope_commit_bridge.test.mjs` now exercises both read-only
methods through **real disposable PostgreSQL**, including current
approved policy fingerprints, actual candidate excerpts, optional
consent, no private scope CAS, denied foreign/revoked actor, and
rejection after a completed human review. The existing 8 required
CI jobs and production approval gates are unchanged.

This is not a deployed browser review UI or live customer approval.
Production Supabase Auth, separate reviewer consent,
PostgREST/RLS/private Storage, signed maintained antivirus,
retention, privacy/legal and security acceptance under Item 3
remain mandatory before exposing this functionality.
