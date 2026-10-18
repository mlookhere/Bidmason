# Read-only receipt-commit uncertainty inspection

**Status: internal audited diagnostic only. No customer endpoint, retry worker, cleanup action, or production capability is enabled.**

When a privileged receipt insert returns a network error or times out, the remote DB transaction may still have committed. A blind second POST risks an immutable conflict and could obscure whether an evidence object is already attributed to a user. The internal `inspectAmbiguousReceiptCommit()` utility performs a single bounded, read-only PostgREST GET scoped to the exact **server-verified organization and canonical object path** using the server-only `sb_secret_` key.

The response is classified as:

- `matching_committed`: an observed trusted row exactly matches organization, path, SHA-256, byte length, MIME and verified uploader.
- `not_observed`: the privileged query returned an empty result **at the time of observation only**.
- `conflict`: an observed well-formed row disagrees with the expected verified metadata.
- `unavailable`: provider error, redirect, timeout, malformed/oversized response, duplicate rows, cancellation or uncertain result.

**Every state is advisory.** Even `matching_committed` is not a customer success response, transaction rollback proof or authorization to reuse the object. `not_observed` does NOT authorize a retry because an earlier write could still commit later; `conflict` requires incident investigation, not automated overwrite. Do not expose statuses or privileged keys in a browser/API or to another tenant. The function has no POST, PUT, PATCH or DELETE and makes at most one network GET; it uses no user-supplied filter or row to choose a provider URL.

The response body is limited to 8 KiB and bounded by a fixed 7-second stream deadline; the provider call also has a fixed timeout and explicitly refuses redirects. Tests cover exact matching, tenant/path/fingerprint conflicts, forged inputs, late cancellation, malformed/oversized responses, provider faults and no retries. It has **not** been tested with genuine Supabase credentials or customer records. Operator reconciliation of object existence, storage bytes, legal holds and live user authorization remains required.

This complements `db/evidence_orphan_audit.sql` and `lib/evidence-orphan-review.ts`: those detect object/receipt inventory discrepancies, while this helper checks one previously known uncertain trusted-receipt transaction without changing anything.
