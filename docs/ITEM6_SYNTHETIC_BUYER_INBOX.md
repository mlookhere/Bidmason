# Item 6 — Synthetic buyer-response inbox projection

**Status: offline simulated inbound review only. Not a live buyer portal, receiver, authenticated event log, CRM sync, signed download, or authorization to contact anyone.**

The pure `summarizeSyntheticBuyerInbox` in `lib/synthetic-buyer-inbox.ts` projects **caller-supplied, fictional** nonbinding buyer question/change-request/decline drafts into privacy-safe operator-review counts. It composes the existing signed `buyer-view-grant` and `buyer-response-draft` validators rather than inventing independent rules or contact permissions.

## Evidence contract

Each event must contain **exactly** these own, enumerable fields: `eventId` (canonical UUID), `viewToken` (signed read-only buyer-view grant), `draft` (the exact identity-bound nonbinding draft shape), and `observedAtSeconds` (integer Unix seconds). Events must form one dense ordinary array of **1–100** records in nondecreasing order of claimed observation time and at or before `nowSeconds`. No accessor-backed/sparse/decorated event records, duplicate event IDs, or reused signed grants are accepted. Invalid event or draft evidence blocks the **entire** projection; nothing is counted partially.

Every event is checked against the required tenant, proposal, approved-content fingerprint, revision, recipient hash, grant signature, supplied revoked-grant list and the grant's **validity at its stated observation time**. The existing draft validator still rejects `approve`, `accept`, `submit`, unsafe text and cross-tenant/mismatched changes. Every signed grant may contribute **at most one** fictional response event to the ledger; a later event with the same grant is rejected even with another event UUID.

**Important limitations:** A caller can fabricate the events, observation time, identity and inputs. Signature consistency and a simulated timeline are **not proof** a genuine buyer responded, that the grant was actually issued by an authorized server, that the event was received before its expiry, or that all prior responses/revocations are available. Do not use these counts to send messages, book a sale, unlock a proposal, or declare contract acceptance.

## Output

The response contains only:

- `state:"inbox-simulation-only"`
- `eventsReviewed`, `questions`, `changeRequests`, `declines`, `operatorReviewRequired` (all invented counts)
- `responseSubmitted:false`, `contactAuthorized:false`, `dataComplete:false`

No grant token/ID, email, recipient, proposal or organization UUID, response fingerprint, note text, signed URL, PDF, personal information or commercial amount appears in the output. Every hypothetical response goes to **operator review**, never automatic follow-up or reply.

## Company-level cross-stream replay detection

`summarizeSyntheticBuyerInboxBatch` combines up to **20 fully supplied fictional streams** and at most **500 total response records** for **one explicitly named synthetic organization**. It executes the existing per-stream validator unchanged, then independently checks that **no event UUID or signed grant ID appears in another stream**. A record duplicated across two proposals or separate revisions blocks the **entire company rollup**, even if both streams are individually valid. Different grants for a single proposal contribute to response counts without inflating `distinctProposals`. All streams representing the **same proposal ID and revision** must also claim the same immutable `contentSha256`, even when the recipient hashes and signed grants differ. A contradictory digest fails the complete rollup instead of merging two different fictional documents as one revision. Distinct proposal IDs or newly numbered revisions may use independently verified digests; this is only an offline consistency rule for caller-supplied signed claims, not a current-document lookup.

All streams must have exactly `identity` and `events`, and each `identity.organizationId` must equal the batch's requested organization. Sparse, decorated, accessor-based, cross-tenant and forged records are rejected, rather than producing partial totals. The batch output adds only `streamsReviewed` and `distinctProposals`; it still contains **no IDs, grant fingerprints, recipient information, note text or link**, and always sets all three non-authorizing booleans to `false`. It does **not** prove all streams were collected, that any event was received, or that a grant was issued by a real buyer-facing service.

`tests-web/synthetic-buyer-inbox-batch.test.mjs` exercises successful redacted multiple-proposal counts, duplicate event UUID across streams, reused signed grant ID across streams, conflicting same-revision content hashes in both stream orders, distinct-recipient grants for the same content, independent revision/proposal content, foreign-organization scope, revoked and forged evidence, unsafe responses, and hostile arrays/accessors. No live CRM, message provider, browser route or database write is involved.

## Testing

`tests-web/synthetic-buyer-inbox.test.mjs` runs offline adversarial cases for independent signed grant counts, nonbinding decline, duplicate event IDs, repeated grants, late/future/backdated and malformed times, invalid signatures/expired/revoked/cross-tenant claims, unsafe draft content and approval/send attempts, hostile accessor/sparse/decorated arrays, mismatched identity/revision and output redaction.

This module is deliberately named `lib/synthetic-*`, so the existing `ci/item6_runtime_boundary.py` live import guard keeps it off all real server entrypoints. It is not imported into the public Delivery Safety Lab and it creates no route, storage table or outbound provider call.

Verify all eight required non-skipped, exact-SHA GitHub Actions jobs. A green source/unit test only confirms **offline model behavior**, not real webhook authenticity or live tenant access.

## Release blockers

A real inbound buyer-portal inbox would still require authenticated buyer identity, tenant-authorized/grant-bound issuance, a server-owned timestamp, safe CSRF/session handling, durable append-only event ingestion, transactionally enforced grant uniqueness and revocation, real current proposal revision checks, private PDF authorization, tenant-isolated audit trail/retention, provider compliance and independent review. H01–H13 remain unverified; **release and customer communication are not authorized**.
