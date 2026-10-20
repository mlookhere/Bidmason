# Item 6 — Delivery preflight foundation (non-sending)

**Issue:** #7 · **Branch:** `work/7-delivery-preflight` from `dev`

This first independent Item 6 deliverable is a **pure, offline preflight**.
It has no API endpoint, outbound provider, database mutation, queue,
email template, webhooks, portal, recipient link, or customer messaging.
The only successful state is `consistent-internal-only`: it is **not**
permission to send.

`lib/outbound-preflight.ts` requires matching organization and proposal IDs,
exact revision, source/policy/content/QA fingerprints, a reviewed proposal,
a single lower-case exact recipient address, two distinct-role/actor internal
review receipts, an explicit recipient-specific clear suppression record
(with a positive version), and a dispatch record whose state is `absent`.
Unknown, opted-out, bounced, queued/reserved, sent and mismatched records
fail closed. Every input has exact own-data fields; hidden permission flags,
getters, malformed emails, duplicate or missing reviewers fail closed.

`deliveryIdempotencyKey` deterministically binds organization, proposal,
revision, source, policy, content, QA, and recipient. This SHA-256 is **not**
a signature, evidence of ownership, permission or a lock. A live service must
perform an authenticated tenant-scoped read, verify trusted origin of all
receipts and suppressions, atomically reserve the key in a durable DB
transaction, enforce current revision and contact state again in the
transaction, and integrate a single provider with signed, replay-safe
webhooks, bounce/DNC updates and idempotent recovery. All these remain
**not implemented**, not green. Two simultaneous callers can both obtain a
consistent offline result; no actual race resistance is claimed.

Tests cover valid dry runs, missing or forged evidence, changed pricing/source
hash, stale approvals, wrong recipients, opt-outs/bounces, unknown/previous
dispatches, malformed and hidden fields, and key uniqueness. The general
required web/Windows test jobs execute the tests without credentials.

## Deferred go-live dependencies

Items 3–5 remain in draft PRs #12, #13, #14 with unverified real Supabase
RLS/Auth/Storage, approved company policies, credential claims and independent
operator/contractor signoffs. The H01–H13 register under Item 5 also requires
provider selection, domain and sender authority, customer communication
consent, legal/privacy/security/operations signoff, and a production go/no-go.
**Do not build a real sending route or merge this into production on
synthetic CI alone.**

## Event-backed CRM delivery projection (synthetic only)

lib/delivery-event-projection.ts derives a read-only status and timeline from
fictional, unsigned events. Exact duplicate IDs are idempotent; conflicts,
cross-tenant identity, mismatched recipient or revision key, malformed dates,
and impossible/out-of-order transitions are rejected for reconciliation.
Bounce, complaint and opt-out flags stay suppressing throughout the stream;
reservations after suppression are rejected. The return status is always
simulation-only, including when a fictional event claims provider delivery.
Required Linux/Windows web tests cover ordering, replay, and negative cases.

This is **not** a provider webhook, an authenticated event store, or permission
to send. Real use still requires raw-body signed provider webhook validation,
durable per-tenant event IDs, atomic dispatch reservation and suppression CAS,
out-of-order recovery, customer consent and sender/legal review.


## Cryptographically scoped buyer-view grant (non-public, read-only)

`lib/buyer-view-grant.ts` now supports *offline* issuance and validation of
15-minute-maximum HMAC-SHA256 grants for a **single organization, proposal ID,
revision, recipient SHA-256 and content SHA-256**, using a 32+ byte secret
held by the caller. Each issuance has an independent random 128-bit grant ID.
The verifier enforces an exact `buyer-readonly-proposal` audience, canonical
base64url and signed JSON, timing-safe signature comparisons, fixed fields,
expiration and optional caller-supplied revocations. Altered claims, wrong
recipients or revisions, expired/future tokens and replay of a revoked grant
are rejected. Node's required test suite includes eight adversarial groups.

The only positive result is **`signed-claims-only`**, not entitlement to
view, proof of buyer identity, ownership, consent, or permission to deliver.
The SHA-256 recipient identifier is a supplied fingerprint, **not anonymous
identity protection** for low-entropy email addresses. The signing key must
be cryptographically generated, maintained and rotated securely server-side;
key length alone does not establish its entropy. A future authenticated
handler must check current tenant membership, current approved revision,
actual recipient identity/consent, and **durable revocations** for the returned
grant ID on every read before ever serving a document. There is no public
route, portal, URL, emailing, response writer or storage added here.


## Provider-free follow-up assessment (simulation only)

`lib/follow-up-assessment.ts` evaluates an explicitly timestamped fictional
delivery event stream, consent policy and previously recorded follow-up
attempts. It returns either `blocked` with specific reasons or
`candidate-internal-only` with a computed earliest due time. The latter
**does not authorize, queue, reserve, schedule or send a follow-up**.

A candidate requires a simulated reported delivery, confirmed fictional
contact consent, no reply or bounce, no complaint/opt-out suppression,
an elapsed company-configured delay, and remaining allowed attempts.
The policy must explicitly specify version, consent state, delay (1–720
hours) and attempt limit (1–3); no company cadence is assumed. A bounded
chronological attempt history is strictly tied to the exact tenant,
recipient and dry-run idempotency key. Identical attempt-ID replays count
once; conflicting reuse, malformed times and out-of-order or cross-tenant
records fail closed. No implicit use of system time or real provider data.

The unchanged mandatory web and Windows test gates run seven adversarial
regression groups covering timing boundaries, opted-out/complained/bounced
recipients, replies, history exhaustion, replay and malformed input.
For real delivery, all source events and consent/attempt records must be
authenticated, tenant-isolated, and committed transactionally with current
suppression and revision checks. Neither a supplied `confirmed` flag nor
a simulated provider event is independently verified consent.


## Nonbinding buyer-response draft validation (no submission)

`lib/buyer-response-draft.ts` builds on offline read-only signed-view
claims without expanding their authority. It validates only three
**nonbinding draft** kinds: `question`, `request_changes`, and `decline`.
It explicitly disallows any `accept`, `approve`, contract-signing or send
action. Every draft is tied to the exact organization, proposal ID, revision,
recipient fingerprint, and content fingerprint of the supplied HMAC-signed
read-only grant. Changed company, document, revision, recipient, or signature
is rejected. Notes are bounded to 500 Unicode code units, NFC-normalized
and restricted to plain printable text; questions and change requests
require a nonempty note. Caller-supplied expired/revoked grants and
already-responded grant IDs block. A fingerprint helps compare identical
**local drafts** but is not an authority, signature, database lock, or
proof that an event was accepted.

The only positive state is `draft-internal-only`. No buyer identity was
authenticated and **no response was persisted or delivered**. A read-only
view token is not a response-submission credential. Real response capture
will require a distinct tenant-authenticated, anti-CSRF-protected endpoint;
an independently authorized buyer, verified scope and active revision;
durable per-grant response uniqueness and revocation; abuse/rate limits;
sanitized server-side persistence with text escaping on all views;
appropriate retention, audit logging and commercial/legal review. All
these are deferred rather than assumed passed. Eight positive/adversarial
Node test groups run under the existing required web/Windows gates.

## Synthetic webhook integrity and replay contract (provider NOT selected)

The dedicated **required** `synthetic-webhook-qa` GitHub job tests
`lib/synthetic-webhook-verification.ts` on Node 24. The same tests are
also included in the existing Linux/Windows `test:web` glob, so the new
job does **not** replace, relax or omit any prior gate. Eight positive
and adversarial test groups operate on fictional JSON and disposable
in-memory signing secrets; no externally provided key is used.

The pure verifier accepts exact raw UTF-8 JSON bytes and an HMAC-SHA256
fixture signature of those bytes and a timestamp with an explicit
`bidmason:synthetic-webhook:v1` domain separator. It enforces 5-minute
signed timestamp tolerance, canonical JSON without duplicate keys,
a 4 KiB input bound, one exact organization/recipient/revision-scoped
idempotency key, allowed fictional provider event kinds, and an event
timestamp consistent with the signed time. It rejects wrong keys,
modified bodies, malformed signatures, unsupported events, conflicting
event IDs and malformed or cross-tenant replay evidence. Exact event
ID/body-hash replays yield `fixture-duplicate-only`, not an accepted
second event; first-pass signatures yield `fixture-verified-only`.
Neither result is proof of provider origin or permission to execute an
event.

**Never reuse this fixture signature format for real email providers.**
The actual email provider and domain still require a user-authorized
choice; its documented raw-body verification scheme, timestamp policy,
key rotation, source-to-tenant mapping, durable uniqueness, signed event
subscription, out-of-order recovery and suppression updates must be
implemented and tested separately. This code does not expose an HTTP
handler, persist any receipt, send email, authenticate a user, authorize a
buyer, prove delivery, or replace the H01–H13 release holds.

## End-to-end synthetic webhook → CRM projection (no provider)

`lib/synthetic-webhook-batch.ts` joins the existing **fictional** HMAC
raw-body verifier and event-state CRM projection. It accepts one local
synthetic reservation and a bounded list of signed synthetic envelopes.
Every envelope must pass timestamp, signature, canonical-byte and tenant
checks **before** it is interpreted as an event. Each new signed event is
reprojected immediately to fail closed on out-of-order or impossible
transitions; identical event ID/body replays are counted but not replayed
into the CRM, while conflicting replays block the **whole calculation**.
Both inputs and outputs remain disposable, nonpersisted, and
`simulation-only`. Bounce, complaint and opt-out states remain sticky.
The verifier never permits a provider to invent a local reservation.

The existing mandatory `synthetic-webhook-qa` job now runs **both**
`synthetic-webhook-verification.test.mjs` and
`synthetic-webhook-batch.test.mjs` (8 additional integration regression
tests); unchanged Linux/Windows `test:web` also exercises both. No
existing CI job is bypassed. This **does not authenticate a real provider**:
the signature/key scheme is only a fictional fixture, an in-memory replay
ledger does not atomically persist event IDs, and a claimed delivered
event is not proof of delivery. Implement actual provider-specific
raw-body verification, trusted tenant dispatch lookup, durable
transactional uniqueness and out-of-order reconciliation only after
provider, consent and authorized Supabase dependencies are resolved.

## Out-of-order signed callback reconciliation (synthetic-only)

`reconcileSignedSyntheticWebhookBatch` is a separate **offline**
mode alongside the unchanged strict-arrival `projectSignedSyntheticWebhookBatch`.
It validates **every** fictional HMAC signature, tenant/revision/recipient
scope, event body and replay ID in a bounded batch **before** ordering
events by their signed UTC observation timestamps. An independent fictional
local reservation remains mandatory. Equal event timestamps on distinct
IDs and callbacks before or at the reservation time are ambiguous and
rejected rather than guessed. It then reruns the complete chronology
through the existing CRM state machine, preserving bounce/complaint/opt-out
suppression, response semantics and hard failure on missing prerequisites.
The result reports moved event positions as `reorderedEvents` and is always
`simulation-only`. It never processes actual provider callbacks, saves
a ledger, resolves durable race conditions or sends a follow-up.

New `synthetic-webhook-reconciliation.test.mjs` regression groups execute
under **both** existing Linux/Windows `test:web` and the unchanged
`synthetic-webhook-qa` job's webhook test glob. This is a full replay
of locally supplied fictional data, **not** a production event merger:
a real provider adapter requires authenticated durable event history,
concurrency-safe event-ID uniqueness, out-of-order buffering policy,
reconciliation alerts and transactional current-state checks. H01-H13
human/live acceptance is unchanged.


## Static synthetic delivery review lab (not a live portal)

The Next development preview includes the route /delivery-lab, a clearly
labeled *fictional, read-only example*. It is NOT access-controlled, and
has no real user, contractor, proposal, recipient or provider data. Five
deterministic examples (reply, bounce, unknown contact consent,
internally due-but-not-authorized, and a prior-proposal opt-out) are computed using the existing
projectSimulatedDeliveryEvents and assessSimulatedFollowUp functions.
Only invented companies, event labels, blockers and explicit warnings
that no one may send or approve anything are shown. There are no forms,
send controls, mutation endpoints, credential checks or external requests.

The delivery-lab web tests verify the five scenario outcomes and static
no-send boundaries. The mandatory Chromium E2E visits /delivery-lab
at 320, 375, 768 and 1280px; checks noindex, correct blockers, five
fictional cards, native event-history disclosure, zero form controls,
no mutation requests, browser errors or overflow. Noindex is NOT access
control: never feed real data into this page. A true operator dashboard
and buyer portal remain blocked on live tenant authentication, consent,
provider evidence, security review and H01-H13 acceptance.


## Publication drift protection for the public synthetic lab

The mandatory fast/PR/security publication guard now validates the openly
reachable /delivery-lab and its single fixture module. It requires the
allowlisted local imports, exactly five fictional scenario labels, reserved
test/example email domains, its own noindex and preview warnings, and no
other subroute or asset. It blocks added API/POST routes, live data sources,
environment/secret access, dynamic imports, remote resources, form/input/send
controls or browser storage. Regression tests in tests/test_publish_guard.py
inject these regressions deliberately and require rejection; existing CI
gates remain enabled and unchanged.

This source-level guard is deliberately conservative defense in depth.
It is not a JavaScript parser, a complete information-flow proof, RLS,
authentication, or a release approval. The page remains publicly
accessible and must contain only invented records. Any real customer
portal or operator dashboard requires a separately reviewed authenticated
route, source-authorized records, consent/legal/security review, and
resolution of H01-H13. Do not bypass this tripwire for a dynamic feature
without implementing those requirements.


## Synthetic delivery exception review (operator triage, no actions)

The pure delivery-triage classifier reuses the existing validated CRM
event projection and follow-up assessment. It categorizes fictional
suppression events (bounce, complaint, opt-out) as stop-contact review;
recipient replies as manual reply review; missing or revoked consent
as consent verification; incomplete delivery as provider-evidence review;
and cooldown/attempt exhaustion as deferred. A fully consistent internal
follow-up becomes *external-authorization-required*, never "send ready".
All outcomes have a permanent review-simulation-only state and no action.

The public /delivery-lab displays the resulting explanation beside each
of its five fictional examples, computed from the actual pure domain
functions. Eight adversarial Node regression groups in the required web
and Windows checks cover precedence, fabricated approval prevention,
replay, chronology, tenant mismatch, consent and incomplete delivery.
Its fixture import is explicitly added to the mandatory publication
guard allowlist, without widening that guard for remote data access.
This does not persist an operator queue, prove that any event occurred,
authenticate a tenant or authorize outbound communication.

## Single-tenant redacted synthetic operator review summary (no queue)

`lib/delivery-review-summary.ts` aggregates a bounded (1–100) set of
**fictional** delivery-triage records belonging to one explicitly specified
tenant. It calls the existing validated `classifySimulatedDeliveryTriage`
for each record and rejects duplicate delivery idempotency keys (even for
identical inputs), cross-tenant records, malformed/accessor-backed evidence,
invalid times and impossible event/consent histories. It returns only count
totals in a stable category order and attention bands: stop contact,
operator review and deferred. It does not return proposal IDs, recipient
addresses, delivery event histories, idempotency keys or consent records.

The result remains `review-simulation-only`, even when fictional timing is
eligible. The existing required Linux/Windows `test:web` glob runs eight new
positive/adversarial groups in `tests-web/delivery-review-summary.test.mjs`
including privacy-safe output, deterministic ordering, duplicate rejection,
tenant isolation and invalid evidence. No provider, live server endpoint,
database, background queue, customer auth or sending ability is added.
This is not a secure real operator dashboard: counts from caller-supplied
fixtures do not prove trusted origin, access control, durable uniqueness or
acceptance of H01–H13.


## Recipient-level suppression across proposal revisions (fictional evidence only)

The new lib/recipient-suppression-history.ts models a critical cross-proposal
safety boundary that a single delivery idempotency key cannot provide: a
recipient's earlier opt-out, bounce or complaint remains a suppression signal
when a new proposal or revision has its own clean-looking delivery history.
reviewSimulatedRecipientContactHistory takes the proposed delivery identity,
zero to 30 historical proposal streams for exactly the same organization and
recipient, and a caller-supplied canonical UTC as-of instant. It validates
every stream with the existing exact-identity CRM projector. Cross-tenant
or cross-recipient records, historical records for the active delivery key,
reused proposal identities, event-ID collisions across different streams,
future-dated events, conflicting replays, and malformed/accessor-backed
inputs all fail closed. Suppression is a monotonic union of historical
bounce, opt-out and complaint reasons across distinct proposal identities.

Both possible outputs have state review-simulation-only and the literal
contactAuthorized: false. Even an empty history or history with no
suppression is labeled no-suppression-seen-in-fixtures, NEVER a verified
clearance. The function cannot authenticate a provider, establish history
completeness, verify revocation/consent, lift suppression, reserve delivery,
access customer data or authorize communication.

The eight new adversarial groups in
tests-web/recipient-suppression-history.test.mjs run under existing
mandatory Linux and Windows Node suites. They explicitly demonstrate how a
new proposal can pass its own internal follow-up timing check while still
being suppressed by an earlier proposal, and cover history/revision and
tenant isolation, sticky reasons, event collision and fake evidence. A live
implementation must use authoritative tenant-and-recipient-scoped durable
suppression data and transactional current-state checks at each send, not
infer recipient contact clearance from proposal-scoped event histories.
H01-H13 external go-live acceptance remain unverified.


## Recipient-aware CRM review integration (synthetic, no outbound action)

lib/recipient-aware-delivery-triage.ts composes the validated CURRENT
proposal's simulated CRM/follow-up review with the separate recipient-wide
historical suppression assessment. Historical bounce, complaint or opt-out
overrides a current proposal's clean-looking state, buyer reply, missing
consent or cooldown state; it becomes contact-suppressed / stop-contact.
Invalid current evidence is evaluated before historical suppression:
neither stream may hide chronology or tenant identity failures.
Every result remains review-simulation-only with contactAuthorized: false.

lib/delivery-review-summary.ts now optionally takes an explicit complete
historical-evidence matrix containing one history stream collection PER
fictional review entry. When supplied, it uses the composed classifier,
so an earlier opt-out changes the REDACTED tenant review totals instead of
remaining a disconnected diagnostic. Missing/misaligned, sparse,
decorated or accessor-backed matrices fail closed. Omitting this optional
input retains the original simulation-only interface but does NOT claim
complete contact history. An explicitly empty history is likewise not
contact clearance. No output reveals recipient, proposal, event timeline,
idempotency key or authorization.

Nine adversarial groups in
tests-web/recipient-aware-delivery-triage.test.mjs exercise suppression
precedence, privacy-safe aggregated counts, compatibility, missing or
cross-tenant history, duplicate/replayed identities, spoofed events and
malformed arrays under existing required Linux/Windows web-test gates.
This does NOT authenticate provider origin, maintain durable recipient
suppression, or atomically recheck contact status before a real send.
All H01-H13 live and human acceptance remain mandatory.


## In-memory recipient reservation race rehearsal (not live sending)

The pure lib/synthetic-dispatch-reservation.ts model addresses a
specific acceptance-test gap: a deterministic dry-run idempotency hash
does NOT prevent two attempts from racing to dispatch. Its fictional
SyntheticDispatchReservationLedger records an in-process per-tenant
and per-recipient version, simulated reservation key and sticky bounce,
complaint and opt-out states. compareAndReserve and
compareAndSuppress model a synchronous compare-and-swap against a
caller's observed version; stale competing attempts fail, a second
proposal for the same recipient cannot reserve while one is pending,
and suppression invalidates a prior fictional reservation. A clean
snapshot is NEVER clearance: every result retains
contactAuthorized: false, and reservations return only
reserved-simulation-only. There is no unsuppress or send method.

Nine tests-web/synthetic-dispatch-reservation.test.mjs groups
exercise simultaneous JavaScript callers, duplicate replay, suppression
before/after reservation, opposite-order reservation/opt-out races,
sticky reasons, unrelated tenants and recipients, forged identities,
hidden accessors and invalid version evidence. They run under existing
required Linux/Windows web suites without credentials, provider calls
or changed CI gates. Single-process Promise scheduling does NOT prove
database or distributed atomicity. This model uses an in-memory Map,
does not survive a process restart, and is explicitly NOT a
production database, lock, sender, release authorization or permission
to contact someone.

Real Item 6 completion must use authenticated Supabase tenant-and-
recipient scoped records, atomic compare-and-swap transactions/unique
constraints, revision and consent revalidation within the transaction,
durable suppression/replay recovery, selected provider/domain and its
verified signatures, race tests against that real database, and all
H01-H13 operator, privacy, legal, security and deployment approvals.


## Integrated non-sending preflight and reservation rehearsal

lib/synthetic-preflight-reservation.ts connects three earlier **fictional**
safety exercises into one reviewed sequence:
(1) evaluateDeliveryDryRun verifies exact organization, recipient, revision,
source/policy/content/QA hashes, a reviewed proposal, two independent actor
receipts, current caller-provided suppression and absent dispatch evidence;
(2) reviewSimulatedRecipientContactHistory validates the same recipient's
prior fictional proposal streams and applies sticky bounce/complaint/opt-out;
(3) SyntheticDispatchReservationLedger.compareAndReserve applies a fresh
in-process version comparison and refuses existing fictional reservations or
ledger suppressions. Both evidence streams are validated before attempting
any ledger mutation, including when the preflight is blocked. Every outcome
includes contactAuthorized: false; the only positive reservation state is
reserved-simulation-only, with no email or other external side effect.

tests-web/synthetic-preflight-reservation.test.mjs contains eleven
positive/adversarial Node test groups: exact-revision consistency, changing
reviewer receipts/revocations, current and historical opt-outs, conflicting
recipient reservations and replays, 48 competing Promise callers, suppression
before and after a fictional reservation, malformed history and hostile
objects. Existing mandatory Linux and Windows test:web jobs execute it.
No new external dependency, route, background job, data store or provider is
introduced. Prior synthetic HMAC and browser jobs remain required.

Important: this is an *in-memory rehearsal* with caller-provided records.
It has no independent source authentication or proof of complete recipient
history; an absence of recorded suppression is not verified consent. The
checks and simulated compare-and-swap are not one durable transaction.
The code must never be imported into a production send route to bypass
tenant authorization, proof of approved revision, real provider idempotency,
server-held credentials or SQL atomicity. Item 6 production acceptance still
requires H01-H13 external evidence, per-recipient transactional state/consent
recheck, a real sender and signed provider callbacks, durable event/dispatch
uniqueness, and authenticated buyer access. All upstream Item 3-5 PRs remain
draft/unmerged.


## Release-boundary guard for Next HTTP endpoints and server actions

The mandatory fast/PR/security publication gate now calls
outbound_endpoint_findings from ci/publish_guard.py across App Router
and Pages Router source trees (including src/app and src/pages).
Until H01-H13 genuinely clear for a real tenant, company and provider,
the guard rejects any newly introduced app route handler, pages/api
endpoint, Next server action directive, form write action, or
middleware/proxy/instrumentation request entrypoint. Symlinks in
publishable Next source directories are also flagged to prevent
unreviewed asset aliases from bypassing source quarantine.
Seven adversarial Python tests cover representative direct and nested
API endpoints, server actions, form submissions, request hooks,
symlinks, and a permitted ordinary static page. They run inside the
existing required tests on fast, PR and security Actions jobs.

This prevents a common release-boundary error: wiring the offline
simulated dispatch reservation and fictional approval inputs to a
public POST endpoint while leaving the synthetic delivery lab read-only.
The restriction is intentionally stricter than ordinary production
Next application architecture while actual authorization, provider
consent, domain ownership, durable Supabase RLS/Storage and atomic
dispatch verification remain unavailable. Removing the categorical
block without replacing it with live route-specific RLS, CSRF,
idempotency, transactional suppression, signed webhook and
independent negative authorization tests is not acceptance.

These source checks do not constitute a formal code audit or a
guarantee that all indirect network behavior is impossible. Item 6
is still unmerged and non-sending; production H01-H13 acceptance and
human signoff remain mandatory.


## Reviewed Next runtime configuration is pinned

The mandatory fast/PR/security publication guard now requires the exact
preview-only Next runtime configuration and rejects missing, symlinked,
edited, or shadow configuration variants. This closes a separate source
release-boundary gap: App/Pages route-file checks alone would not detect
a Next configuration that added redirects, rewrites, or new server
behaviors while leaving existing pages unchanged. Four new adversarial
Python regression methods check rewrites, redirects, server-action
configuration, alternate config files, missing/symlinked files, and
unreviewed comment edits. Static-preview settings remain unchanged.

This deliberately conservative source drift tripwire is not a
comprehensive Next build or network security proof. When authenticated
production endpoints are explicitly approved, any change to the Next
config requires conscious security review and new negative tests, not
simply removing the guard. Outstanding H01-H13 real Auth/RLS, approved
proposals, provider/domain/consent, signed callback and durable atomic
dispatch requirements remain blocking. No live API, customer data,
provider connection, email or deployment has been introduced.


## Tenant-scoped CRM summaries in the public fictional lab

The static /delivery-lab now includes an accessible, noninteractive CRM
review overview above its five fictional case histories. It
reuses the pure summarizeSyntheticDeliveryReview engine rather than
hardcoded counts, and groups source fixtures by the *exact* fictional
organization ID before aggregation. These two organizations must never
be merged: the fictional painting company has two operator-review cases,
while the fictional cleaning company has two stop-contact cases and one
operator-review case. Both have zero deferred cases in these fixtures.

The public summary returns only the invented company display label,
reviewed-case count and three attention-band totals. Organization IDs,
proposal IDs, recipient addresses and delivery idempotency keys are not
returned to the page. Its shared builder checks that records inside
each tenant group use a consistent fictional company label. Tests
assert the real underlying calculation, group boundaries, lack of
identifiers in serialized results, and explicit simulation-only state.
The mandatory Chromium browser test verifies both visible summaries,
their counts, no extra interactive controls or mutation requests, and
responsive layout at 320, 375, 768 and 1280 pixels.

This is a *public, static fictional demo* and not a CRM populated with
customer data, authenticated operator access, verified consent, a
work queue, or a delivery permission. The existing publication guard
allowlist adds only the reviewed offline summary module; no provider,
network, storage, server action or POST endpoint is introduced. Real
CRM access, buyer portal and outbound sending continue to require
all H01-H13 live tenant, provider and human release acceptance.


## Historical recipient suppression in the public fictional lab

Five strictly invented scenarios now demonstrate the cross-proposal
contact-suppression rule in the actual public, noindex /delivery-lab,
not just in isolated unit tests. The existing four examples remain,
and a fifth *cleaning contractor* case has an internally due-looking
current proposal but an earlier opt-out in a different proposal for
the same fictional recipient. Its classification and visible follow-up
status are STOP CONTACT / blocked, with a separate plain-language
prior-suppression explanation. A simulated follow-up due time never
overrides a previously recorded opt-out, bounce or complaint.

Each unrelated case has its own literal .example-only fictional
recipient, preventing the former fixtures from accidentally sharing
contact history. Only the opt-out example reuses the exact recipient
across its two separate proposal identities. The same exact-history
matrix is supplied to the existing tenant-scoped CRM summary; the
cleaning company's three cases now count two stop-contact reviews and
one operator review, while painting retains two operator reviews.
The page receives no recipient addresses, proposal identities or
idempotency keys. No real recipient, consent, provider or origin
is authenticated.

Required Node and Chromium tests validate the fifth scenario, its
prior opt-out override despite an otherwise internally eligible
assessment, the two company-specific review totals and no live
mutation or accessible send action at 320, 375, 768 and 1280px.
The mandatory publication guard now permits only the reviewed
recipient-history-aware pure helper imports, pins **exactly five**
fictional scenario labels, and continues to reject real email
addresses, side-effect imports and unapproved Next routes. The
literal fictional addresses remain testable by negative source
injection; they are not exposed through the rendered lab.

This improves the correctness and observability of a synthetic
demonstration only. Historical event origin and completeness,
authoritative tenant/recipient DNC, actual consent, live
reviewer identity, signed provider callbacks and atomic per-send
suppression checks are still unverified. H01-H13 and draft PR holds
remain unchanged. Never interpret the absence of fictional prior
events as customer contact clearance.


## Transitive import guard for the fictional public lab

The earlier mandatory publication guard checked the public Next
/delivery-lab page and its fixture module but did not inspect the
runtime modules they imported transitively. This left a source-only
release boundary gap: an otherwise-approved pure helper could later
import an unreviewed provider/client or gain an outbound side-effect
without modifying the page or fixture's direct imports.

The required fast/PR/security publication check now inspects all
seven known reachable offline domain helpers. It enforces exactly
reviewed import specifiers for every helper, disallows new import
side effects and module re-exports, rejects missing or symlinked helper
files, and applies the lab's conservative no-network/no-storage/no-
environment/no-server-action source patterns to these modules too.
Unapproved real email literals are also forbidden anywhere in this
reviewed dependency chain. The sole reviewed built-in dependency is
node:crypto for deterministic local SHA-256 hashing; no network or
customer credentials are used.

Five additional negative regression methods inject unsafe indirect
fetch/env/dynamic-import/client storage/server-action code, unapproved
external/side-effect imports or re-exports, missing/symlinked files,
nonfictional email, and an unrelated helper that should NOT be
mistaken for a reachable public module. The tests execute as part of
the existing mandatory Python suite; no required job was disabled,
skipped or softened. Adding a genuinely needed helper requires
explicitly reviewing and testing its transitive effects before
updating the pinned import contracts.

This remains a deliberately conservative **source-level drift
tripwire**, not a complete JavaScript parser, bundle analysis,
information-flow verification, or production RLS proof. Dynamic and
indirect effects outside the guarded known import tree cannot be
declared impossible solely from these checks. The public lab still
contains only deterministic fictional records, no sender, API,
real buyer credentials or personal data. H01-H13 and the unmerged
upstream authentication/provider acceptance gates stay blocking.
