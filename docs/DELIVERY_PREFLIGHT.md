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
has no real user, contractor, proposal, recipient or provider data. Six
deterministic examples (reply, bounce, unknown contact consent,
internally due-but-not-authorized, a prior-proposal opt-out and a prior-proposal reply) are computed using the existing
projectSimulatedDeliveryEvents and assessSimulatedFollowUp functions.
Only invented companies, event labels, blockers and explicit warnings
that no one may send or approve anything are shown. There are no forms,
send controls, mutation endpoints, credential checks or external requests.

The delivery-lab web tests verify the six scenario outcomes and static
no-send boundaries. The mandatory Chromium E2E visits /delivery-lab
at 320, 375, 768 and 1280px; checks noindex, correct blockers, six
fictional cards, native event-history disclosure, zero form controls,
no mutation requests, browser errors or overflow. Noindex is NOT access
control: never feed real data into this page. A true operator dashboard
and buyer portal remain blocked on live tenant authentication, consent,
provider evidence, security review and H01-H13 acceptance.


## Publication drift protection for the public synthetic lab

The mandatory fast/PR/security publication guard now validates the openly
reachable /delivery-lab and its single fixture module. It requires the
allowlisted local imports, exactly six fictional scenario labels, reserved
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
of its six fictional examples, computed from the actual pure domain
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
prior fictional proposal streams, including sticky bounce/complaint/opt-out
and past-reply manual-review signals;
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
review overview above its six fictional case histories. It
reuses the pure summarizeSyntheticDeliveryReview engine rather than
hardcoded counts, and groups source fixtures by the *exact* fictional
organization ID before aggregation. These two organizations must never
be merged: the fictional painting company has three operator-review cases,
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
recipient-history-aware pure helper imports, pins **exactly six**
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


## Cross-proposal historical reply manual-review hold (fictional only)

The earlier recipient-wide history review retained bounce, complaint and
opt-out but discarded a past recipient reply on a DIFFERENT proposal.
This could leave a new proposal with a due-looking follow-up even though
the same recipient had already engaged and an operator should review
that exchange before another automated reminder.

The pure review now exposes only a boolean repliedInHistory, derived from
previously validated per-proposal fictional event projections. The
recipient-aware triage also reports historicalReplyObserved. A prior
reply alone moves a new proposal into reply-needs-review / operator-review
instead of external-authorization-required, with explicit manual-review
copy; it does **not** create a permanent recipient opt-out. Prior bounce,
complaint or opt-out always outranks any reply and remains stop-contact.
Event identity, tenant/recipient matching, chronology and replay
validation remain mandatory even for a suppressing or replied history.

Six additional Node regression groups under existing required Linux and
Windows web-test gates cover historical reply precedence, privacy-safe
redacted CRM category totals, independent sticky bounce+reply handling,
order independence, and fail-closed corrupted or future event evidence.
Neither fictional engagement nor absence of it proves a real reply or
permission to contact. Real communication still requires authenticated
tenant-scoped reply ownership, trustworthy event origin, customer consent,
verified suppression, human review and transactional dispatch constraints.
No response endpoint, automatic follow-up, schedule, database mutation,
provider, or email is added. H01-H13 and draft PR holds remain unchanged.


## Reply-aware preflight reservation rehearsal (synthetic only)

The integrated synthetic preflight/reservation flow now enforces the
historical-reply hold that was already represented in recipient-aware CRM
triage. Previously, an earlier fictional recipient reply on a different
proposal changed the operator review category, but
rehearseSyntheticDeliveryReservation still checked only historical
opt-outs, bounces and complaints before performing an in-memory CAS.

After validating both complete preflight and historical evidence, the
rehearsal now checks suppression first, then repliedInHistory. A prior
reply returns blocked / prior-recipient-replied and leaves the ledger
unchanged; it requires manual operator review and does not turn a reply
into a permanent opt-out. A past bounce, opt-out or complaint still wins
as prior-recipient-suppressed regardless of replay ordering. A fictional
clean-history rehearsal still yields at most reserved-simulation-only,
never a customer send, provider call or authorized contact.

Four additional required Linux/Windows Node test groups assert direct
prior-reply holds, suppression precedence across separate earlier
proposals, 24 concurrent fictional contenders blocked with no version
change, and malformed cross-recipient event evidence rejected even if
the current proposal is revoked. No new runtime module, route, queue,
provider, DB, credentials, email, or CI gate is introduced. Source
fixtures and in-process CAS do not authenticate a recipient, prove full
historical coverage, establish a real manual review, or provide durable
transactional safety. H01-H13 and human/live acceptance remain blocking.


## Post-reservation fictional reply review hold (no live dispatch)

Earlier fictional recipient replies already blocked new-proposal preflight
when present in validated caller-supplied historical streams. A distinct
gap remained for a reply received *after* the in-memory reservation:
only bounce, complaint and opt-out could invalidate a pending synthetic
reservation in the CAS ledger.

SyntheticDispatchReservationLedger.compareAndRecordReply now provides a
version-checked, fictional reply-review transition. A successful local
transition increments the tenant/recipient scoped version, invalidates
the current synthetic reservation and sets replyReviewRequired=true
without adding a permanent bounce/complaint/opt-out. Subsequent CAS
reservations return recipient-reply-review-required. Repeated reply
observations are harmless blocked duplicates; later permanent suppression
retains priority and preserves the reply-review flag. No API is provided
to clear reply review or reactivate a reservation: a genuine authorized
human review and trusted durable DB design remain outside this model.

Five additional synthetic ledger tests verify reply-before/reservation-
after, reservation-before/reply-after, 32 adversarial same-version races
with explicit refreshed-version retry, coexistence with sticky complaint,
and forged/hidden/invalid identity evidence. Two integrated preflight
tests verify that a reply after a fictional reservation blocks subsequent
same-recipient/new-proposal attempts, and that historical replies retain
priority when current in-memory review flags also exist. Existing
mandatory Linux/Windows Node tests exercise all seven groups without
changing any required checks.

All state is volatile, untrusted, caller-supplied and simulation-only.
No real inbound reply origin is verified and no actual consent, provider,
user authorization, buyer view, sender credentials, message, database
transaction, distributed lock or release authorization is implied.
Actual inbound replies must be authenticated and applied atomically
with send reservation in a durable tenant-scoped store after H01-H13
human/live acceptance; a synthetic concurrency test does not prove this.


## Verified-fictional-webhook contact-hold reconciliation (non-sending)

The synthetic raw-body signature + chronological CRM projector and the
synthetic per-recipient in-memory CAS ledger previously ran independently.
A fictional signed provider bounce, complaint, opt-out or recipient reply
could be projected into CRM without updating the held reservation.

The new reconcileSyntheticWebhookContactHold flow first validates the
ENTIRE signed fictional batch through the existing raw-byte HMAC,
exact tenant/recipient/revision checks, duplicate event IDs, chronological
reconciliation and the existing CRM transition reducer. Only after
successful validation does a single version-checked in-memory
compareAndApplyContactSignals operation atomically union all projected
sticky suppression reasons and reply-review state while invalidating
any fictional reservation. Stop-contact suppression outranks reply review.
Empty or identical replayed contact signals never advance the version;
stale competitors cannot overwrite a newer hold.

Eight new Linux/Windows Node regression groups cover late replies,
out-of-order signed callbacks, mixed complaint+reply in a single version
transition, idempotent duplicate replay, forged HMAC/tenant/chronology
rejection before mutation, 32 competing CAS requests, malicious
caller-supplied signal shapes, and unrelated tenant isolation.

**This is not a trusted email integration.** The HMAC format, secret,
reservation and envelopes are entirely fictional and caller supplied;
the in-memory state is volatile, unsynchronized across processes and
cannot prove genuine provider events, customer identity, consent,
actual delivery or real contact authorization. It must never be
exposed through an API or connected to a sender. A real adapter requires
provider-specific signature verification, server-trusted local dispatch
lookup, RLS and durable transactional event/recipient atomicity, plus
all outstanding H01-H13 legal/security/operations/human approvals.


## Bounded fictional webhook contact-hold CAS recheck (never a real sender)

The strict one-attempt reconcileSyntheticWebhookContactHold API deliberately
returns blocked / stale-or-invalid-version when a simulated reservation
changes after the caller observed its version. This is safer than silently
claiming the fictional webhook hold was applied, but leaves the
fictional recipient reservation intact until another caller retries.

The additional reconcileSyntheticWebhookContactHoldWithRetry function
models an *explicit*, **0–3 maximum stale-version recheck budget**, without
changing the strict original API. It authenticates the entire fictional
signed callback batch and validates event scope/chronology/replay once,
BEFORE any ledger mutation, then retries only a valid stale CAS with the
current in-memory recipient version. The final result exposes a
staleRechecks count and unresolvedStaleVersion boolean. If budget
exhausts or the caller supplied an invalid original version, it reports
blocked without pretending that suppression or reply review was stored.
A duplicate/no-op callback also reports blocked rather than acceptance.

Seven required Node regression groups cover stale reservation recovery,
explicit zero-recheck unresolved state, identical replay/no-op, combined
opt-out+reply atomic update after a stale version, 36 competing callers,
tampered event rejection before CAS, and malformed/out-of-range retry
budgets. Existing test/web, Windows and synthetic-webhook suites remain
mandatory. No CI gate is relaxed or replaced.

This bounded synchronous fixture has no actual asynchronous provider,
queue, durable replay history, process restart or distributed SQL
transaction. It cannot authenticate customer consent or make a real
communication decision. A real integration must retain and recover
failed authenticated callbacks durably, protect recipient contacts with
transactional locks and observed-version updates, and meet H01–H13
external acceptance. Do not wire either simulation API to customer
delivery or treat an exhausted retry budget as a successful hold.


## Prior-reply manual-review case in the public fictional lab

The static /delivery-lab now displays six invented cases, adding an
independent painting-contractor **earlier-proposal reply** scenario.
Its CURRENT proposal has a normal-looking reported delivery and
internally eligible follow-up timing, but a DIFFERENT fictional proposal
for the same recipient previously received a reply. The existing
recipient-aware classifier therefore returns reply-needs-review /
operator-review with historicalReplyObserved=true. The page shows
**Blocked**, an explicit earlier-reply detail, and a manual-review
explanation, even though the underlying current-proposal assessment
alone would be candidate-internal-only. A reply remains distinct from
sticky opt-out/bounce/complaint suppression and none of these cases
allows contact.

Both company-scoped CRM totals are calculated using the actual
historical-evidence matrix: painting now has 3 operator-review cases
and zero stop-contact; cleaning has 2 stop-contact and 1 operator review.
The new scenario uses its own .example fictional recipient and distinct
proposal identities. No raw recipient, tenant, proposal or dispatch
identifiers are exposed. Public preview remains noindex, static and
read-only, not access-controlled or suitable for real records.

Required Node tests, source-level publication guard and real Chromium
E2E cover all six cards, correct per-tenant aggregate counts, visible
earlier-reply hold and blockers, no forms or mutation requests and
320/375/768/1280px responsive layouts. The guard explicitly pins
exactly six invented case definitions without permitting new runtime
imports, network access, secrets, or dynamic customer data.
H01–H13 and upstream draft PR holds remain unchanged; synthetic
history does not establish verified consent or authenticate a reply.


## Immutable proposal-revision identity in fictional recipient history

Recipient-history review now rejects two distinct dry-run delivery keys that
claim the **same proposal ID and revision**, even when their source, pricing,
content or QA digests differ. A historical record that conflicts with the
**current** proposal ID and revision is rejected as well. Immutable revisions
may not be changed in place to disguise duplicate or conflicting history.
Earlier numbered revisions of the same proposal remain valid historical
streams so their opt-outs, replies, complaints and bounces still block or
require review. Tests cover conflicting keys in both orders, conflict with
the current revision, and valid prior revision suppression.

The keys and revision claims here remain caller-provided fictional fixtures,
not independently authenticated records or complete recipient history. The
result never authorizes communication; H01–H13 and live tenant/provider
acceptance requirements are unchanged.

## Proposal-scoped chronological revision guard (fictional only)

The recipient-history validator now rejects future-numbered revisions of the
**current** proposal when presented as earlier history. The existing same-
revision conflict guard remains unchanged, and an actually older revision of
that proposal can still contribute historical opt-out, bounce, complaint and
reply evidence. Revisions on *other* proposals are independent, not compared
to the current proposal's revision number. Positive and adversarial Node
coverage includes integrated preflight checks that reject a false historical
revision **before** changing the in-memory reservation ledger, even when the
current fictional review is revoked. The result is still caller-supplied,
non-sending and non-authoritative; this cannot establish actual revision
chronology, tenant authentication, consent or real contact clearance. H01–H13
and all real provider/database/release requirements remain blocked.


## Unreviewed Next-page network and storage tripwire

The mandatory fast, PR and security publication guard now rejects direct
browser network APIs (fetch, WebSocket, EventSource, XMLHttpRequest,
WebTransport, sendBeacon), client-side persistent storage primitives,
`createClient`, and `process.env` references in all Next application/page
source trees, not only the fictional delivery lab. Earlier checks covered
unreviewed HTTP route files, server actions and form submissions; a new
ordinary page with a client-side network operation could previously bypass
those checks. Adversarial Python cases cover App/Pages Router and `src/`
variants, while ordinary static informational pages remain permitted.

This deliberately conservative source-level release tripwire is **not** a
JavaScript parser, dependency/alias analysis or formal guarantee that no
network side effect can exist. A genuinely authorized live workflow must
replace these temporary blocks with independent tenant-safe endpoint,
provider, consent, privacy/security and transactional tests. No production
email, credentials, customer data, portal, endpoint or deployment is created,
and H01–H13 acceptance remains outstanding.

## Fictional follow-up attempts after stop-contact evidence

An offline CRM attempt record timestamped **at or after** the first fictional
recipient reply, opt-out, provider bounce or complaint in that delivery stream
is now rejected as conflicting history. Previously the dry-run returned a
blocked recommendation but still counted such contradictory attempts as
internally coherent. Valid earlier attempt records remain countable, although
the assessment remains blocked by the subsequently observed contact signal.
All four stop-contact kinds and the chronological boundary have regression
coverage under unchanged required Linux and Windows web tests.

This validates caller-provided synthetic evidence, NOT a real customer contact
audit. It cannot prove that an attempt or reply occurred or authenticate
consent. Live provider receipt, durable audit/recovery, tenant-scoped storage,
company policies and all H01–H13 human/release requirements remain pending.
No API route, provider, database or outbound side effect was introduced.

## Strict fictional CRM event timestamp ordering

The offline `projectSimulatedDeliveryEvents` projector now rejects two
**distinct** event IDs with identical UTC observation timestamps. Previously
the strict arrival-order reducer allowed a tie even though the fictional
signed-webhook reconciliation path already treated the same ordering as
ambiguous. Exact duplicate event-ID/body replays remain idempotent, including
after later distinct events. An adversarial Node regression checks simultaneous
reservation/acceptance, simultaneous suppression events, and allowed exact
replay. No fabricated tie-breaker or implicit event order is introduced.

This is a stricter validation contract for fictional event fixtures, not a
real provider event chronology or reliable timestamp source. Genuine
same-time events will require an independently specified provider/DB ordering
and durable reconciliation policy. H01–H13 tenant, consent, provider, SQL
transactional and human release dependencies remain unverified; no live
endpoint, storage or sending was enabled.

## Stop-contact precedence when a fictional reply arrives after suppression

The in-memory `SyntheticDispatchReservationLedger.compareAndRecordReply`
now preserves `suppressed-simulation-only` as the returned verdict if a
recipient already has sticky opt-out, bounce or complaint evidence. The
newly observed fictional reply is still retained as
`replyReviewRequired: true`, but cannot downgrade the contact's primary
stop-contact state into a reply-only review classification. Reservation
remains blocked by the suppression state; replay and per-recipient version
checks remain unchanged.

Two added Node regression groups test all three suppression reasons, the
reply-after-suppression path, and 32 opposite-order same-version CAS races
with explicit refreshed-version retries. Neither event ordering can clear a
suppression or produce a sending authority. No new API, email provider, DB,
workflow, or public route is introduced. This is strictly synthetic local
state, not authenticated event intake, transactional RLS/consent, or proof
that a person may be contacted. H01-H13 remain blocking.

## Minimum follow-up cadence validated in fictional attempt history

The offline `assessSimulatedFollowUp` reviewer now requires **every prior
recorded attempt**, not just the *next* candidate, to respect the supplied
company policy's `minimumDelayHours` from the originally reported delivery
or the immediately preceding unique attempt. Earlier history with two
one-minute-apart reminders could previously be treated as internally
coherent (merely exhausted) despite violating the 24-hour fictional policy.
This validation now fails closed with a distinct minimum-delay error. An
identical attempt-ID/body replay remains idempotent and does not restart the
cooldown. Existing chronological, stop-contact, tenant, and caller-fixture
checks remain required and have regression coverage at the millisecond
boundary, for exact eligibility, conflicting retries and stricter policies.

This does not establish that a provider sent anything, that consent existed,
or that company policy and historical attempt records are trustworthy.
The synthetic result can never authorize a contact; real audit/recovery,
tenant RLS, transactional suppression, provider, policy approval and H01–H13
human release acceptance remain blocked. No web route, sender, persistence,
secret, provider integration or CI gate was introduced.

## Tenant-local CRM event-ID uniqueness in fictional summaries

The non-sending `summarizeSyntheticDeliveryReview` now rejects a provider
`eventId` reused by two distinct proposal streams inside the same
fictional tenant summary. Previously each stream was individually validated,
but a colliding ID on a different proposal could be counted twice across
CRM cases. The existing recipient-history validator already enforced this
boundary for its historical collections. Exact same-ID/body replays inside
**one** validated stream remain idempotent and do not become cross-proposal
collisions. This rule does not compare independent tenant summaries.

The public six-case lab now assigns deterministic distinct fictional event
IDs to each case and its optional historical proposal, without changing
scenario meaning, company grouping, contact restrictions or visible counts.
Required Node coverage tests reversed collision order, legitimate distinct
streams, exact replay in one stream, and independent tenant scopes; the
existing delivery-lab source tests also remain required. No customer
records, signed live provider callback, database, sender, route, external
request, or new dependency was added. These are fabricated IDs, not
provider authenticity or durable uniqueness evidence. Production tenant
RLS, signed webhook event IDs, transactional deduplication and H01–H13
human release acceptance remain mandatory and unverified.

## Immutable fictional proposal-revision identity within CRM summaries

The non-sending tenant-local `summarizeSyntheticDeliveryReview` now rejects
two different dry-run delivery keys that claim **the same proposal ID,
revision number and recipient** in one summary, even if their source,
policy, proposal content or QA fingerprints differ. Previous checks rejected
identical dispatch keys and event-ID collisions, but could count conflicting
immutable proposal-revision identities as two independent CRM cases.

Regression cases reject all four fingerprint changes in either input order,
while allowing legitimately distinct revisions, different fictional
recipients for a shared proposal revision, and unrelated proposal IDs. The
rule is recipient-scoped so one approved proposal revision may still be
shared with multiple distinct recipients without treating those deliveries
as duplicates. All outputs remain redacted counts with
`review-simulation-only` state. This proves neither actual immutable
storage nor authenticated approvals; real transactional tenant/recipient
uniqueness, RLS, consent, provider evidence and all H01–H13 human release
acceptance remain outstanding. No live endpoint, sending or persistence is
added, and existing required CI gates remain unchanged.

## Cross-stream event identity checks for fictional tenant CRM summaries

When a full historical recipient-evidence matrix is supplied, the existing
tenant-scoped `summarizeSyntheticDeliveryReview` now checks event IDs across
**both** current delivery streams and all validated historical streams in the
same tenant review. Earlier coverage detected collisions among current
proposals but allowed two individually valid historical collections to make
contradictory claims about the same provider event ID.

Repeated **identical** history across multiple cases remains valid, including
when a proposal's exact current stream is shared as an earlier stream of
another fictional proposal. Reuse with a different proposal identity,
recipient, event kind or UTC observation time now fails closed; the existing
current-versus-current collision error remains stable. Added Node adversarial
tests cover cross-scope reuse, opposing history order, same-proposal conflicting
timestamps, separate fictional recipients, and exact replay acceptance.

This remains only deterministic local, caller-provided synthetic review
evidence: it cannot authenticate actual provider IDs, establish complete
recipient histories, provide durable event deduplication, infer consent, or
authorize a message. No new dependencies, routes, data stores, credentials,
provider integration or CI-gate modifications were introduced. H01–H13
tenant, transactional, legal, security and human release gates remain blocked.

## Immutable historical revision reconciliation in fictional CRM summaries

The single-tenant `summarizeSyntheticDeliveryReview` now compares the
**proposal ID, revision and exact recipient** across all validated current
and historical streams. If two such claims produce different dry-run
idempotency keys (including modified source, policy, content or QA hashes),
the entire review fails closed. Previous checks rejected contradictory
current entries and event-ID collisions, but distinct event IDs could hide
two incompatible immutable versions in separate historical collections.

Identical fictional historical claims may be reused by different cases,
and a current proposal may appear as another case's exact earlier history.
A genuinely distinct revision remains independent, and different recipients
are not assumed to share one dispatch key. Required Node regression tests
cover both history orderings, conflict against the current entry, valid
repeated evidence and legitimate revision changes. The existing current-
current duplicate and event-ID checks remain intact.

These are untrusted, invented offline records: a passing check cannot
authenticate source history, prove tenant scope or consent, create real
immutable persistence or authorize contact. Production H01-H13 RLS/Auth,
transactional consistency, provider signature, approval and human release
gates remain blocked. No API, sender, external provider, database,
credentials, build configuration or CI gates were added or weakened.

## Immutable proposal evidence across fictional recipients

A proposal revision's source, pricing-policy, content and QA SHA-256
fingerprints are now checked across **all recipients** in the same tenant CRM
review, including validated earlier-proposal histories. The per-recipient
idempotency key properly changes with the recipient, but cannot conceal
different proposal evidence being presented as the *same* immutable
proposal ID and revision. Previously only conflicting claims for the exact
same recipient were rejected; different recipients could conceal divergent
content hashes behind independently valid dry-run dispatch keys.

Positive and adversarial Node regressions check all four hashes, reversed
entry order, different recipients with identical revision fingerprints,
legitimate distinct revisions/proposals, and contradictions in historical
and current-vs-historical streams. Existing same-recipient, replay, event-ID,
tenant-isolation and simulation-only outputs remain unchanged.

This checks only local, invented, caller-supplied identities. It does NOT
establish approved source material, authenticated buyers, complete history,
immutable production storage, consent, real delivery, or permission to send.
A live provider, tenant RLS, durable transactions, signed callbacks,
operator/contractor approval and all H01-H13 release gates remain mandatory
and unverified. No endpoint, email, customer data, database, deployment,
dependency, required CI job or gate policy was added or weakened.

## Tenant-local follow-up attempt-ID audit integrity (fictional only)

The read-only `summarizeSyntheticDeliveryReview` now enforces one
fictional follow-up `attemptId` per unique proposal delivery within
a single tenant's CRM batch. Prior per-proposal checks validated replay
and chronology but did not detect the same attempt identifier claimed by
two different proposal delivery streams or different recipients. That
would make the aggregated audit evidence ambiguous. The summary rejects
these cross-proposal IDs rather than silently counting them as separate
legitimate follow-ups. Each stream's original validator still recognizes
an exact attempt-ID/body replay as a single attempt.

Tests cover reversed case order, cross-recipient collisions, separate
legitimate IDs, exact same-stream replay, and independent tenant
summaries. This adds no new backend, provider, endpoint, storage,
recipient data, credential or CI configuration. Attempt IDs remain only
synthetic caller-supplied strings, not a trustworthy provider audit or
durable tenant-unique constraint. Authenticated event origins, RLS,
transactional persistence and H01-H13 release acceptance remain
unverified and blocking; a review can never authorize sending.

## Known recipient-wide contact holds in one fictional CRM batch

The tenant-local `summarizeSyntheticDeliveryReview` now reconciles already
validated **current and supplied historical** stop-contact or reply observations
across *all* reviewed proposal records for an identical fictional recipient.
Previously a bounce, complaint, opt-out or reply discovered for one proposal
could leave a second proposal for the same recipient counted as merely
internally due. The new two-pass redacted summary first validates **every**
case, replay and immutable identity, and then applies the strongest known
recipient hold to that recipient's cases: **stop-contact outranks reply-review**,
which outranks a clean-looking current case. The result is order-independent;
unrelated recipients never inherit a hold. Source events and IDs are never
exposed by the returned aggregate.

Regression coverage checks opposite orderings, a current bounce or reply,
mixed reply/stop-contact, a prior-proposal opt-out supplied for only one of
two cases, isolated recipients and tenants, and the existing fictional
public-demo grouping. The fixture-only batch is not a complete contact
history and does **not** prove independent provider origin, consent,
recipient ownership, durable suppression or actual review authorization.
Missing recipient history is **never** contact clearance. No sender,
provider, live API, queue, database, customer data, new dependency or
required CI-gate change was introduced. H01-H13 Auth/RLS, signed provider
evidence, durable transactional holds and human go/no-go remain blocked.

## Tenant-wide fictional stop-contact chronology for follow-up audits

`summarizeSyntheticDeliveryReview` now compares **all validated current
follow-up attempts** with the earliest known reply, opt-out, provider bounce,
or complaint for the same tenant and exact recipient across the current
batch and its optional supplied historical streams. Previously a different
proposal's already-recorded contact-stop signal could downgrade the
redacted review totals but still leave a later cross-proposal attempt
record accepted as coherent history. Attempts recorded **at or after** a
known stop now reject the entire synthetic review instead of silently
counting the attempt. Earlier attempted follow-ups remain valid evidence
(subject to the existing per-proposal minimum delay and consent checks).
Both input orders, all four stop kinds, equal timestamp boundaries,
historical evidence supplied for only one case, and recipient isolation
have explicit Node regression coverage.

This is a deterministic **audit consistency check on untrusted fictional
fixtures**, not proof of real events or complete history. It does not
persist suppression, verify contact consent, authenticate a provider,
reserve a dispatch, authorize a follow-up or provide a sending route.
Current redacted output contracts, no-action default and publication
guards remain unchanged. H01–H13 real tenant RLS/Auth/Storage, approved
revision and consent, verified signed callbacks, durable atomic
recipient-wide holds and written human go/no-go are still unverified.
No CI check or release gate was removed or relaxed.

## Synthetic signed-webhook replay ledger self-consistency

The offline `verifySyntheticWebhookFixture` verifier now rejects a processed
receipt ledger that contains **the same event ID with two different raw-body
SHA-256 hashes**, even when that corrupted ID is unrelated to the currently
presented signed event. The earlier validator checked every individual
record's shape, then examined only receipts matching the incoming ID; this
could classify a new event as `fixture-verified-only` while accepting
contradictory stored evidence for a different event. The full bounded
caller-provided ledger must now be self-consistent before any fixture
verification result is reported.

Exact duplicate ID/hash receipt evidence is still allowed and remains
idempotent. A repeated incoming ID with its exact existing body still
returns `fixture-duplicate-only`; same-ID/different-hash records reject
the verification context. Focused tests cover unrelated conflicting ID
pairs in both orders, harmless identical duplicates and conflicts for the
incoming event. The synthetic HMAC/domain separator, input limits,
timestamp checks, real-provider prohibition and required CI gates remain
unchanged.

No actual provider origin, durable storage, tenant authorization, consent,
replay resilience across restarts, real signature scheme, or outbound send
authority is established. A real integration still requires selected
provider/domain and verified signatures, transactional event deduplication
and recipient suppression, negative tenant RLS tests, human approvals and
all H01–H13 release requirements. This adds no API, browser change, queue,
database or external network operation.

## Impossible future-version CAS claims never recover as stale (fictional)

The optional bounded `reconcileSyntheticWebhookContactHoldWithRetry` model
previously retried any well-formed mismatched version, including a claimed
**future** recipient version greater than the actual in-memory ledger.
That is not a stale optimistic-concurrency observation and must never be
silently normalized into a successful fictional contact hold.

The retry path now distinguishes a genuinely old observed version
(`version < actual snapshot.version`) from an impossible future
observation. Only the former may consume the explicit 0–3 stale-recheck
budget. A future version returns blocked / stale-or-invalid-version,
`unresolvedStaleVersion: true`, `staleRechecks: 0`, and leaves the
fictional recipient reservation unchanged. A matching current version
can apply its already-validated fictional signal immediately; existing
genuine stale-version retries remain covered by their original regression
tests. Added an adversarial Node case for a one-step future version,
a maximum-range future version, and a matching version.

This is still an in-process fixture with caller-supplied HMAC keys and
records: no provider origin, durable ledger, real CAS, contact consent,
database recovery or human approval is proven. It does not send, unlock
reservations, alter API routes or waive any mandatory CI gates. Actual
tenant-scoped SQL transactions and H01–H13 real go-live signoffs remain
unverified and blocking.

## Hostile fictional suppression array indexes are rejected before use

The volatile `SyntheticDispatchReservationLedger.compareAndApplyContactSignals`
previously used `Array.every` to validate the caller-supplied suppression
list. JavaScript reads an array element **before** calling the predicate, so
an accessor-backed indexed entry could execute untrusted getter code even
though the predicate attempted to inspect its descriptor. An indexed data
entry that was hidden (non-enumerable) also passed the earlier data-only
check, contrary to the existing strict evidence contract.

The local compare-and-swap rehearsal now reads each indexed property
**descriptor first**, requiring an enumerable own data value and an allowed
canonical suppression reason; only validated local values are considered
for ordering, duplicate detection and sticky state reconciliation.
Adversarial tests require accessor getters to remain completely unread,
non-enumerable indexed values to reject, the fictional reservation/version
to remain unchanged after either rejection, and an ordinary opt-out
update to remain successful and non-authorizing. Existing reply,
complaint, bounce, tenant-isolation and optimistic-CAS tests are preserved.

This does not authenticate real inbound webhook evidence, provide durable
recipient suppression, persist events, authorize a contact, expose a
sending route, or lift an existing hold. H01–H13 production tenant Auth/RLS,
verified provider signatures/consent, durable transactional idempotency
and written human go/no-go still block release. No CI gate, API,
dependency, provider or database behavior was added or weakened.

## Source-backed Item 6 external release evidence inventory

The current source-derived, **all-unverified** production dependency record
is [ITEM6_RELEASE_EVIDENCE.md](ITEM6_RELEASE_EVIDENCE.md) with a strict JSON
manifest and adversarial Python regression checks. Passing simulation CI
only confirms the inventory stays fail-closed; it can never authorize a
production provider, customer delivery, buyer portal or release. The real
Phase 3 tracker work (BM-015b, BM-029 through BM-034 and DEC-06) and all
human/tenant/legal/security go-live requirements remain outstanding.
