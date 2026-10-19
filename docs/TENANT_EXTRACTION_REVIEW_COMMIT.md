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
