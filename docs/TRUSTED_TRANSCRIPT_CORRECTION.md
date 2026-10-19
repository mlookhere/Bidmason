# Item 4 — Transactional transcript correction authorization contract

This is an **internal server-only persistence interface**, not a live Supabase
adapter, browser endpoint, or authorization credential.

- \`readTranscriptCorrectionContext()\` retrieves only current tenant-authorized
  unresolved transcript records. The response presents provider-origin
  ambiguous excerpts, the current expected source revision and a SHA-256
  **consistency** fingerprint to drive an explicit human correction review.
- \`commitAuthorizedTranscriptCorrection()\` accepts a source UUID, current
  revision/snapshot fingerprints, an independently recalculated correction
  fingerprint and one explained replacement for every provider-declared
  uncertainty. It rejects arbitrary approval, actor, pricing and send fields.
- The **trusted** \`TrustedTranscriptCorrectionStore.mutateAuthorized()\` must
  validate verified session, current tenant membership, source ownership and
  \`correct-transcript\` permission **at commit time in the same transaction**.
  The callback recomputes all edits from the *stored* original and rejects
  stale or tampered revisions. It preserves raw provider outcome, increments
  source revision, and appends a server-derived reviewer identity and immutable
  correction audit atomically. It returns \`corrected-for-human-review\` only
  after a confirmed durable commit.
- The committed revision can be offered to the existing source-bound extraction
  review system. It is **not** a quotation approval: a separate human must
  review candidate services and the currently approved tenant pricing. The
  original audio/transcript still stays private with retention controls.

This contract has a serializing **in-memory test double only**; it must never be
used as a production data store. Exact authenticated Supabase persistence,
transaction-level authorization, rollback testing, real reviewer identity,
source/Storage ownership and append-only audit are still unimplemented. A
frontend checkbox, a SHA-256 checksum, or a passing mock test is no proof of
human authority. Do not merge/deliver this as customer functionality without
Item 3 Auth/RLS/Storage/AV, retention, privacy and security acceptance.

Regression tests include race collisions, reviewer revocation before a queued
transaction, cross-tenant/role denial, actor forgery, original tampering,
unversioned changes, missing/dishonest persisted results and replay rejection.
No customer upload/download, paid action or proposal send was enabled.

## Durable read-back validation

The server contract does not trust `mutateAuthorized` returning an apparently
valid record. It compares the full returned transition to the exact transition
calculated by the authorized callback, then performs a **fresh authorized,
primary/linearizable** `readAuthorized` of the same tenant/source revision,
including all correction audit fields and original provenance. If the store
returns success without persisting, returns modified reviewer/audit data,
changes immediately after the commit or revokes read access, this call **does
not claim success**. The read must not use an eventually consistent replica.

A final read failure **does not imply rollback**: the transaction may have
already committed. Operators must reconcile this indeterminate result by
reading durable source and audit state with proper authorization, not blindly
retrying the same source mutation or charging/sending a customer. Backend
atomicity, RLS and audit append-only enforcement remain mandatory.
