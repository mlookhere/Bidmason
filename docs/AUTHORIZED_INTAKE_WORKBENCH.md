# Item 4 — Authorized internal extraction workbench

This integration is server-only and not routed to any customer-facing page or API. It composes the existing Item 4 modules without importing unmerged Item 3 code.

- lib/authorized-intake-workflow.ts resolves active approved company pricing via TrustedPolicyStore.readAuthorized. readAuthorizedReviewWorkbench uses two fresh membership-authorized reads and rejects mid-load policy changes.
- previewAuthorizedWorkbenchSelection checks the browser reviewKey against a freshly computed source/candidate/policy workbench key; rejects additional request directives and rechecks selection, pending services and optional add-on acknowledgement on the server before computing preview-only economics.
- The final authorized read rejects membership revocation or pricing changes during calculation.
- tests-web/authorized-intake-workflow.test.mjs exercises eleven mocked-store cases covering tenant separation, forged keys, stale ratecards, tampered evidence and revocation.

The workbench checksum is NOT a signature or client authorization. A future trusted adapter must fetch original/review records from tenant-owned persistence, enforce database-level membership and atomic revision compare-and-swap; arbitrary caller-supplied originals must not be accepted as ownership proof. Mock sessions do not establish live Auth/Storage acceptance.

No persistence, customer routes, uploads, sending, invoices or approvals were enabled. The pending Item 4 PR and deferred Item 3 genuine security acceptance remain tracked gates.

## Source-backed context validation before authorized reads

The internal workbench now calls the existing canonical source/extraction
provenance validator on all candidate evidence **before** snapshotting its
original/review context. This is important because JavaScript
`structuredClone` can invoke ordinary object getters, even for data that
later fails source-integrity checks. The preliminary validation checks the
original's exact data shape, transcript state, candidate/array descriptors,
UTF-16 excerpts and both immutable source/review digests without executing
untrusted getters. It uses the first candidate solely as a structural
validation probe, **never** as a reviewer approval or priced selection.

Malformed or tampered evidence now fails without calling the trusted policy
store. Valid evidence continues through the two separately authorized policy
reads and human-selection checks. This closes a local data-boundary gap,
not the independent requirement for server-owned source retrieval, genuine
tenant authorization, live RLS/Storage testing or final proposal approval.
