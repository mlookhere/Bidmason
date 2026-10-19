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

**Deliberate trust limit:** PostgreSQL validates bounded candidate structure
but DOES NOT independently reproduce JavaScript's UTF-16 offsets or the
canonical candidates-array SHA-256 algorithm. Therefore it is not safe to
invoke directly with browser or unvalidated AI JSON. A future server
`TrustedExtractionStore` implementation must derive the actor through a
fresh verified Supabase session, load the original under transaction/CAS
controls, call `parseUntrustedExtraction` against that original to validate
every exact excerpt and recompute the candidate hash, then pass only the
validated review to this private SQL function. It must perform fresh authorized
primary read-back and treat ambiguous commits as **indeterminate** (never
retry blindly). This adapter and genuine provider session tests are still
outstanding. Unrelated same-tenant actors cannot extract another member's
private typed note with this staged function.

The `intake-db` Actions job installs the candidate SQL after the prior
source/ledger/lookup suites and executes `ci/db_intake_extraction_test.sql`.
It checks positive original/audit preservation and adverse cases including
foreign tenant, same-tenant other actor, missing source, wrong source hash,
hidden approval/pricing fields, stale duplicate and post-revocation denial.
All tests run on a disposable PostgreSQL instance, not live Supabase.
Item 3's Auth/Storage/ClamAV/retention/security acceptance remains mandatory;
there is no customer-facing route or approval to deploy.
