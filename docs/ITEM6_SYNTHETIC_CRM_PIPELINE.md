# Item 6 — Synthetic event-backed CRM pipeline

**Status: internal fictional simulation only. No production CRM, customer data, revenue, recipient contact, or go-live authorization.** The companion core modules remain `lib/delivery-event-projection.ts`, `lib/delivery-review-summary.ts`, `lib/synthetic-deal-outcome.ts`, and `lib/recipient-aware-delivery-triage.ts`.

The pure `summarizeSyntheticCrmPipeline` function in `lib/synthetic-crm-pipeline.ts` is an offline reporting adapter for controlled delivery Item 6, not a persistence layer, authenticated API, customer portal, or dispatch worker. It builds counts from **caller-supplied fictional** proposal delivery event streams, explicit per-case terminal deal event arrays, consent policies and optional aligned recipient-history arrays. The source of every event remains unverified.

## What the report means

- **Delivery funnel:** counts `notStarted`, `reserved`, `accepted`, `reportedDelivered`, `bounced` **per case/recipient/revision**, using the existing deterministic delivery projector. A `reportedDelivered` count reflects only a fictional event; it is **not provider-confirmed customer delivery**.
- **Deal funnel:** counts `won`, `lost`, `unverified` **per unique proposal**, so multiple recipients or revisions of the same proposal cannot inflate a reported deal. An empty outcome array is **unverified** — never assume a deal is still open or has closed. A known fictional terminal outcome remains counted if another case for the same proposal omitted it.
- **Attention:** copies the redacted `stopContact`, `operatorReview` and `deferred` totals from the existing tenant-scoped review-summary logic. Earlier fictional bounces, complaints, opt-outs, and replies continue to require stop/contact review as appropriate.
- **Output privacy:** returns **only counts and static state strings**. No organization ID, recipient, proposal ID, JWT, provider payload, message contents, policy hash, financial amount, link, grant, or contact permission.
- **Hard invariants:** the full aligned deal-outcome matrix is mandatory. The underlying review validator rejects malformed input, cross-tenant streams, collisions, conflicting revision hashes, contradictory terminal outcomes, replay collisions, stop-contact chronology and unsafe follow-up history **before aggregation**. Historical streams are accepted only when explicitly supplied for each case.

Across one supplied tenant review, the same fictional UUID cannot identify a delivery callback, a follow-up attempt, and/or a won/lost terminal event. The review gathers IDs from current delivery streams, explicitly provided historical streams, previous attempts, and deal-outcome events, then rejects cross-family collisions regardless of input order. This mirrors the existing disposable SQLite cross-ledger event-identity test. It is an **in-memory consistency check over supplied fixtures only**, not proof of a persistent production-wide event namespace.

The output always contains `state:"crm-simulation-only"`, `contactAuthorized:false`, `dataComplete:false`. No action, send endpoint, webhook, live CRM integration, storage write or proposal access was added.

## Fictional delivery-lab presentation

The existing static `/delivery-lab` page now shows the same redacted, tenant-scoped `SyntheticCrmPipeline` counts alongside the prior review/attention totals. `buildSyntheticDeliveryLabSummaries` groups the already-invented seven case fixtures by **organization UUID**, then calls `summarizeSyntheticCrmPipeline` with the corresponding full event, outcome and history matrices. No case data or buyer identifiers are newly serialized into the page. The display explicitly distinguishes **delivery counts per case** from **deal counts per unique proposal** and labels every total fictional and incomplete.

`tests-web/delivery-lab.test.mjs` checks each fictional company's stage and deal totals, reviewer-count reconciliation, zero contact authority, absent sensitive identifiers, and the static page's disabled-input contract. This is a non-interactive preview, not a CRM dashboard connected to actual tenants.

## Offline verification

`tests-web/synthetic-crm-pipeline.test.mjs` covers redacted multi-case aggregation, same-proposal multi-recipient deduplication, missing outcomes, adversarial matrix shapes/getters, wrong-tenant/malformed evidence, contradictory closure/replayed event identifiers, aligned history and a closure carried across proposal revisions.

Run the unchanged locked dependency and web gates:

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run test:web
```

GitHub's exact-head `web-build`, `win-fast`, `pr`, `security` and other required Actions checks must independently succeed. A locally passing test or a previous-head green run is not a release gate.

## Not production acceptance

A real event-backed CRM would still need independently authorized tenant Auth/RLS, complete durable append-only event ingestion, signed provider webhook validation, provider/domain/consent and suppression state, persistent transactionally reconciled uniqueness, current proposal approvals, authenticated buyer responses, operational monitoring, retention and recovery, security/privacy/legal review, and human go/no-go. **H01–H13 remain unverified. The release manifest and customer sends remain blocked.**
