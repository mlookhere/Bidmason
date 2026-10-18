# Evidence orphan reconciliation — read-only review gate

**Status:** dry-run/review classification only on draft PR #12. No deletion, cleanup worker, public HTTP route or automatic retention policy is enabled.

Existing authenticated upload performs insert-only private Storage upload **before** issuing an immutable verified receipt. If receipt issuance, hash readback or authorization fails, Storage may contain an unreceipted object. Such an object is **not** proof of an abandoned upload and must never be deleted immediately.

- `lib/evidence-orphan-review.ts` accepts trusted **complete** Storage and receipt snapshots, validates the fixed `bm-evidence` bucket, tenant-scoped path, duplicate entries, timestamp chronology, and requires completion flags on both inventories. A receipt or an object updated within 24 hours is retained. Older unreceipted objects become *review candidates only*, deterministically sorted.
- `db/evidence_orphan_audit.sql` provides a **read-only** inventory query for an audited privileged operator. It has no DELETE, UPDATE, RPC, or grants. Inspect the entire bucket inventory; an RLS-filtered browser result is not a complete privileged snapshot.
- `tests-web/evidence-orphan-review.test.mjs` exercises classification, recent/present receipts, forged tenant paths, incomplete inventories, duplicate entries, invalid/future timestamps and boundary age. All tests use synthetic records.

**Operational requirements before any cleanup:** establish lifecycle status and reconciliation of concurrent upload/readback, confirm a missing receipt using an independent second query, validate object ownership, preserve any legal hold, comply with agreed retention, log operator approval, and use a separate strictly authorized delete workflow with race-safe revalidation. A generated candidate does NOT authorize delete or imply safe removal. Storage client DELETE remains forbidden, including for signed-in organization members. No production object cleanup has occurred.

The existing private evidence download and upload endpoints retain their separate disabled/unfinished status. Real two-user Auth+Storage testing, server-side malware scanning, a provisioned scanner, and secure deployment remain required before PR #12 can be merged.

## Direct Storage bypass eliminated before release

The additive `bm_evidence_server_only_insert` restrictive policy denies `bm-evidence` uploads made using any direct signed-in user token, including from a member of the correct tenant. Only a properly constrained server-managed upload design may eventually write to the bucket using a private elevated credential after the trust boundary. Existing private reads and manual-only receipt-less object triage remain unchanged. This intentionally blocks the previous user-JWT write adapter, which **must not** be exposed as a customer upload route. No blind retry, mutation or automatic orphan deletion is authorized.
