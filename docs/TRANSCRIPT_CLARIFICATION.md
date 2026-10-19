# Item 4 — Manual transcript clarification drafts (unrouted)

`lib/transcript-clarification.ts` provides a deterministic, source-bound way
for an internal reviewer to propose corrections to provider-declared unclear
speech and ambiguous quantities **without losing the original wording**.

`listTranscriptClarifications` identifies each exact UTF-16 source span and
reason. `prepareTranscriptCorrectionDraft` requires exactly one bounded
replacement plus an explanation for **every** uncertainty. It rejects malformed,
overlapping, missing, duplicate and extra-directive inputs. Multiple edits are
applied against the original transcript positions, with corrected positions
and old/new text retained in an audit-ready change record.

The output is **`awaiting-authorized-correction`**, including audio/source,
corrected text and correction SHA-256 fingerprints. It deliberately emits
`proposedSource.transcriptionSucceeded=false`: existing extraction refuses
it until a future **authenticated reviewer** saves an immutable, tenant-owned
corrected transcript revision with durable compare-and-swap and audit data.
The checksum is only consistency metadata, not a signature, approval, Auth
identity or proof that corrections are accurate. This helper has no callback
that bypasses that trusted activation step.

Provider-reported uncertainty can be incomplete; human review is still
required even for transcripts without declared ambiguities. No raw audio is
downloaded, forwarded, published or stored here, and the original provider
segments continue to refer to the uncorrected source; they must not be
silently relabeled as offsets in the corrected transcript.

Regression tests cover multi-span positional shifts, exact preserved
provenance, reordering, missing/duplicate corrections, forged approvals,
overlapping source references, oversized output and extraction blocking.

The underlying Item 3 tenant Auth/Storage, review roles, antivirus, retention
and customer-input release gates remain deferred but mandatory. This module
does not enable a new public route or live transcription provider.