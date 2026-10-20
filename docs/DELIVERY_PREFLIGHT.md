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
has no real user, contractor, proposal, recipient or provider data. Four
deterministic examples (reply, bounce, unknown contact consent and an
internally due-but-not-authorized case) are computed using the existing
projectSimulatedDeliveryEvents and assessSimulatedFollowUp functions.
Only invented companies, event labels, blockers and explicit warnings
that no one may send or approve anything are shown. There are no forms,
send controls, mutation endpoints, credential checks or external requests.

The delivery-lab web tests verify the four scenario outcomes and static
no-send boundaries. The mandatory Chromium E2E visits /delivery-lab
at 320, 375, 768 and 1280px; checks noindex, correct blockers, four
fictional cards, native event-history disclosure, zero form controls,
no mutation requests, browser errors or overflow. Noindex is NOT access
control: never feed real data into this page. A true operator dashboard
and buyer portal remain blocked on live tenant authentication, consent,
provider evidence, security review and H01-H13 acceptance.


## Publication drift protection for the public synthetic lab

The mandatory fast/PR/security publication guard now validates the openly
reachable /delivery-lab and its single fixture module. It requires the
allowlisted local imports, exactly four fictional company labels, reserved
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
of its four fictional examples, computed from the actual pure domain
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
