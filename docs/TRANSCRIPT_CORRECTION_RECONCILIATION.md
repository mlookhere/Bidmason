# Item 4 — Correction commit reconciliation after an indeterminate outcome

\`lib/transcript-correction-reconciliation.ts\` adds a **read-only**, server-side
reconciliation path for a transcript correction when a network error, failed
read-back or permission revocation makes the write's result uncertain.

\`reconcileTranscriptCorrection(store, session, originalCommitRequest)\` calls
the trusted tenant-owned \`readAuthorized\` on the **primary/linearizable**
database source. It accepts exactly the original source and correction request
with no approval/send instructions and performs **no mutation or retry**.

Results:
- \`confirmed\`: the authorized record is at expected revision + 1 and its
  stored original, corrected text, exact reviewer-identified audit fields,
  correction fingerprint and ordered changes match the request.
- \`unchanged-at-read\`: the latest visible record still has the original
  revision, uncorrected source and no audit. This is **not** proof of rollback
  or permission to retry: an outstanding request might commit after this read.
- \`conflict\`: record/provenance/audit differs from the expected transition,
  including unrelated later revisions. Investigate the authorized audit before
  any further operation.

Invalid requests, unavailable records and revoked membership **throw**. Those
errors never imply a rollback. Reviewer identity comes from stored authorized
audit records, not the browser request; this read-only helper cannot independently
prove that the backend checked the role when it wrote that audit.

The production adapter must supply a consistent primary read and separate
operation-level audit and reconciliation controls. No client form, retries,
quote approval, customer communication or Storage access is enabled. These
are mock-tested contracts pending Item 3's real Auth/RLS/Storage/AV acceptance.
