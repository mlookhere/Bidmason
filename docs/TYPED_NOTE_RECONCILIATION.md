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
