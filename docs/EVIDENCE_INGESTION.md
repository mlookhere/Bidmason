# Evidence ingestion — trusted server workflow core

The pure `prepareEvidenceReceipt()` helper validates file signature, size and MIME and derives SHA-256/path from actual provided bytes, not client metadata.

`ingestVerifiedEvidence()` in `lib/evidence.ts` now enforces this **server-side sequence** using injected privileged adapters:

1. Validate canonical actor/organization identifiers and immutable snapshot of uploaded bytes.
2. Require authorization from a trusted check tied to current Auth/session and database membership.
3. Upload under the authorized actor to private `bm-evidence`; no upsert/overwrite.
4. Re-read the exact private object and recalculate its digest and byte length. Abort on any mismatch or failed read.
5. Recheck membership after storage work, then allow a **server-only privileged** evidence receipt insert. Authentication and membership checks cannot come from client-supplied claims.

**Scope**: This is a rigorously tested workflow **core**, not a deployed HTTP upload route or a real Storage API test. The HTTP-contract adapter in `lib/supabase-evidence-port.ts` and tenant-pinned privileged writer in `lib/supabase-receipt-writer.ts` now exist with mocked tests. **Neither is deployed or exercised with a real Supabase Storage session**; secure secret custody and verified session cookie/JWT transport, MIME parser, malware scanning, orphan-object cleanup and actual uploaded-document claim authenticity are still required. Failed uploads/missing readbacks/revocations cannot mint receipts; failed receipt inserts may leave orphaned objects to clean via trusted maintenance. The platform remains closed to customer uploads.

Tests: `tests-web/evidence-ingestion.test.mjs` runs with native Node and covers authorized ordering, tenant authorization denial, read-back tampering, mid-flight revocation, async input mutation, MIME and ID validation and unavailable providers.
