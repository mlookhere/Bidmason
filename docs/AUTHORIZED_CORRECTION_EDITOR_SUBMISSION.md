# Item 4 — Authenticated correction-editor submission boundary

**Status:** Internal server-side contract with a synthetic trusted store;
**no production Supabase adapter, public route, login flow, or deployment**.

`lib/authorized-correction-editor-submission.ts` bridges a browser
`ExtractionCorrectionPanel` payload to the existing
`commitAuthorizedExtractionCorrection` transaction. Browser input carries
ONLY source/candidate checksums plus explicit replace/remove/add decisions
and bounded explanations. The caller selects the tenant/source from its
independently authenticated, authorized context; it must never accept a
browser-supplied actor identity or give the editor a trusted revision token.

The adapter authorizes **two independent primary reads** to obtain a current
revision and full source snapshot consistency digest. It then rereads the
actual tenant-owned original plus immutable provider extraction, verifies
the browser's source/candidate hashes against those stored facts, runs the
existing strict server `prepareExtractionCorrectionDraft`, and DETACHES
all validated changes into fresh canonical records. Finally, the existing
trusted `correct-extraction` locked mutation rechecks current membership,
source ownership, exact CAS revision and snapshot, recalculates the
correction SHA-256, invalidates any prior human scope decision, records
append-only provenance, and requires an independently authorized primary
read-back. The output is only
`correction-committed-pending-activation`—never approved, activated,
previewed or ready for customer delivery.

Revocation, cross-tenant access, changed originals, modified source IDs,
fake pricing/approval fields, stale CAS, tampered provenance and duplicate
submissions fail closed. A lost mutation acknowledgement/read-back is
**indeterminate**, not a confirmed rollback, and must NOT trigger an
automatic retry; the existing read-only reconciliation contract can be
applied from durable trusted server-side request context when available.

This module alone does **not** wire a React callback to a live endpoint,
grant a production role, preserve a server-side idempotency token,
prove RLS, or satisfy evidence retention/malware-scanning gates. Production
requires a real tenant-owned transactional store, independently verified
two-user Auth/PostgREST/Storage isolation, approved per-company commercial
policy, signed AV, retention, legal/privacy/security and operational
acceptance. The original provider extraction and source remain immutable.

## Async caller mutation protection

The server bridge now takes a **complete, bounded data-only snapshot** of
the tenant/source selector, SHA-256 evidence identifiers, and every nested
correction action/candidate *synchronously before the first Auth/DB await*.
Any unexpected own keys, sparse arrays, action/candidate accessors or more
than 100 changes are rejected before privileged reads. A mutable browser
caller cannot change the submitted quantity, source identity, reason, or
action array during authentication or query latency. This snapshot is
strictly a transport-integrity boundary: the existing server provenance
validator still enforces human explanations, candidate spans, service
eligibility and correction semantics against the stored original. Tests
also verify that accessor getters never run and denied payloads cause
zero privileged reads or writes.
