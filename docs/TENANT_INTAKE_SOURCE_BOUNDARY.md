# Item 4 — Tenant-owned intake record boundary

The internal, unrouted `lib/tenant-intake-service.ts` requires an authorized source UUID rather than taking arbitrary client-supplied text/extraction suggestions as evidence. Its `TrustedIntakeStore.readAuthorized` port must derive tenant membership from a genuine verified session on **each** read, fetch the exact organization's current source snapshot from durable storage and reject cross-tenant or deleted documents.

The boundary validates source and tenant identifiers, revision, returned ownership and bounded input before composing the existing approved-only policy review. It reads the same source again after authorized policy calculation, rejecting changed revisions or altered original/extraction data even if a buggy provider forgets to increment the revision. Browser input is limited to source ID, organization locator and human review selections. No client-supplied price, original, policy or approval is accepted by this wrapper.

This is a security **contract**, not a deployed Storage implementation or cryptographic proof of ownership. The snapshot checksum is not a MAC or approval; the provider must enforce actual tenant-scoped RLS and authenticated source ownership. A future send/publish still requires one atomic reauthorization of current evidence, ratecard and reviewer approval. No customer route, upload/download, billing or sending is enabled. Deferred Item 3 live Auth/Storage/AV/security acceptance remains mandatory.

## Completed correction quarantine

The source-owned original `readTenantIntakeWorkbench` and
`previewTenantIntakeSelection` also reject `correctedScopeReview`, not
only a pending/activated correction. Once a corrected extraction has been
separately selected by a human, the **original** extractor's candidate review
must never reappear through generic pricing. All three correction lifecycle
columns are inspected by the shared descriptor-safe guard and bound to the
authorized source snapshot, including second-read consistency checks.
Explicitly NULL database columns are compatible with a genuinely uncorrected
intake. The new regression tests cover completed corrected scope, state
arriving between authorized reads, and legitimate NULL-column records.

The separate corrected-scope draft preview remains internal-only, and
these protections neither install real tenant Storage/RLS nor approve or
deliver a customer quote.
