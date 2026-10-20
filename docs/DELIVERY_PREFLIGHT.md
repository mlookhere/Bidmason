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
