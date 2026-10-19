# Item 4 — Read-only typed-note creation reconciliation

When a create response or post-commit read-back fails, the transaction may have
committed even though the caller saw an error. NEVER create a new request UUID,
blindly retry a write, or infer a rollback from that error.

The server-only reconcileAuthorizedTypedNote helper takes the exact original
organization UUID, request UUID and note text. It does NO writes, uploads,
extraction, approval, sending or payment. It asks TrustedTypedNoteLedger for
two separately authenticated primary/linearizable reads of the ORIGINAL
idempotency ledger key and its current source record.

For each read the adapter MUST:
- Derive the current actor from the verified session, NEVER client input.
- Enforce current organization membership, create-intake role and tenant
  visibility BEFORE returning a row or a nonexistence result.
- Atomically join a UNIQUE (organization_id, actor_id, request_id) ledger row
  to its current source revision on the primary database, with no replica lag.
- Return the ledger's immutable original text SHA-256 and authenticated actor,
  never a browser-controlled assertion, and return null only for true absence.

The verifier checks the original request digest, immutable creation audit,
source text, progression through bounded extraction and reviewed scope fields.
A stored hash or actor UUID alone is NOT evidence of actual authorization;
only the production backend's transaction can provide that guarantee.

Results:
- confirmed-unprocessed: original source at revision 1, no review.
- confirmed-advanced: same original at revision 2 or 3, with validated
  extraction/review progression. NOT approval or permission to reprocess.
- not-found-at-read: both authorized reads saw no ledger entry. NOT proof a
  pending write will not commit later, and NEVER permission to retry.
- changed-during-read: the observed ledger/source changed between reads.
  Reconcile again through the trusted ledger; do not infer rollback.
- conflict: receipt, original payload, audit, or stored evidence mismatch.

Auth/access failures or unavailable storage THROW; they must not be converted
to not-found or confirmed. No live Supabase adapter or API endpoint is added.
Only mock-backed tests currently validate this interface. The Item 3 genuine
two-user Auth/RLS/PostgREST/private Storage bytes, AV, abuse/recovery and
security acceptance gates remain mandatory before a customer feature exists.


## Server-only verified-session to primary-SQL adapter (staged)

`lib/trusted-typed-note-ledger.ts` now implements the read-only
`TrustedTypedNoteLedger` interface against two explicit ports:

1. `ActiveSessionVerifier.verifyActiveSession(opaqueSession)` must validate a
   real **current, non-revoked** server Auth session on *each* invocation and
   return only a trustworthy canonical user UUID. It must not use a caller's
   `actorId`, `userId`, role, tenant ID or an unverified decoded token.
2. `PrivateIntakeDatabase.query` must use a server-held service-role
   **primary PostgreSQL** connection, never a browser connection, read replica
   or public PostgREST RPC. It executes only the parameterized
   `bm_intake_private.lookup_typed_note($1,$2,$3)` call. The private SQL
   routine rechecks and locks current membership before revealing a receipt
   **or the absence of a receipt**.

The adapter verifies selector/permission shape before Auth, requires the
verified actor UUID before any SQL, and rejects malformed or more-than-one-row
results, incorrect returned actor, invalid ledger digest or missing JSON.
The existing `reconcileAuthorizedTypedNote` then verifies the complete
original text/audit and revision-bound extraction evidence across two
independent fresh reads. Neither component writes, retries, creates an
idempotency key, or interprets absence as proof of rollback.

Regression tests in `tests-web/trusted-typed-note-ledger.test.mjs` cover
fresh Auth checks, revocation between reads, forged caller identity,
cross-tenant backend denial, replay absence, malformed ledger responses,
tampering, and provider errors. They use an in-memory mocked verifier and
database. This is a staged adapter contract, **not** evidence that a live
Supabase provider, genuine session, production database connection or
original source migration has been configured or tested. There is no
browser-accessible route and no permission to enable customer intake.

Do not advance Item 4 until Item 3's genuine two-user Auth, PostgREST/RLS,
Storage bytes, antivirus, retention, throttling and privacy/security gates
are independently accepted. A success on mocked tests alone does not
authorize merging draft PR #13 or deploying this workflow.
