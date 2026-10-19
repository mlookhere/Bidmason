# Item 4 — provenance-bound extraction review (non-networked foundation)

The first independently deliverable part of Issue #5 is a **pure** typed-note
and successful-transcript review boundary in `lib/intake-review.ts`.
It does not depend on Item 3's unmerged authenticated storage branch.

An extractor can propose `serviceCode`, positive integer `units` and an
exact source character range/excerpt. The code rejects missing, altered or
oversized originals, failed or unverifiable transcription, malformed/oversized
candidate sets, and mismatching source excerpts. A SHA-256 binds the review
to the exact source kind and original text. Source text is not executed,
treated as company policy, or converted to a price without explicit selection.

`previewReviewedQuote()` requires a caller-supplied selection of specific
candidate indexes and the unchanged original. It delegates to the existing
tenant-configurable, exact-cent `quoteFromPolicy()` engine; missing codes,
duplicate services and pending commercial terms remain unquotable. Its
return state is **preview-only**, never an approved/sendable proposal.

This is **not** document Storage, an AI extractor, human-authorization
middleware, policy persistence, legal approval, price acceptance, or a
publicly enabled intake endpoint. Those stay future Item 4/Item 3 gates.
Actual source bytes, authenticated organization policies and immutable
approval records will be bound only through a trusted server workflow.
Do not import Item 3's unmerged code, fabricate credentials or merge its
blocked PR merely to pass this CI. The historical painting and distinct
cleaning pricing scenarios remain independent regression fixtures.

Tests: `tests-web/intake-review.test.mjs` covers explicit review,
source-tampering, invalid provenance, failed transcription, pending services,
company independence and preview-only semantics.

## Untrusted extraction adapter and review snapshot checks

`lib/intake-extraction-adapter.ts` accepts only a 32-KiB bounded strict JSON
shape containing up to 50 candidates, each with **only** service code,
positive integer units and exact source excerpt/span. Model-supplied pricing,
approval, document changes, system-role claims and unknown output fields are
rejected, not passed through. Markdown/partial JSON is rejected. A failed
transcript cannot be extracted.

`ExtractionReview.candidatesSha256` binds the suggested candidates to their
original snapshot, and preview generation recomputes it before human
selection. This detects accidental/in-place draft tampering; its checksum
is **not a trusted server signature**. A malicious client can forge both
data and checksum, so the future authenticated backend must bind the
source and review to tenant-owned persisted records and authorize reviewers.
Never mark parser output approved or sendable. Six adapter-specific and
one snapshot-tampering regression test were added.

## Shared-source extraction validation — strict known fields

The extractor JSON adapter already rejects arbitrary candidate keys. The
shared `prepareExtractionReview` and `selectReviewedServices` boundaries
now enforce the same closed candidate schema (service code, units, UTF-16
start/end offsets and source excerpt), and a closed extraction-review schema,
for **every caller**, including local adapters and later stored-review readers.
Previously a caller could supply a candidate with an extra `rateCents` or
`approved` property: the checksum covered only approved fields, so the
additional property could pass through the general boundary. Unexpected
fields now fail closed on both creation and subsequent review/preview, even
on an **unselected** candidate. This does not alter normal valid selections,
deterministic company-owned pricing, or human authorization requirements.

No live database, browser route, customer action or additional production
permissions are created. Hashes only support consistency, never authentication.

## Canonical original, candidate and review data boundaries

The shared source validator now checks **own enumerable data-property descriptors** on plain (or null-prototype) records rather than trusting `Object.keys` alone. Hidden properties, symbol keys, inherited directives, getters, setters and unrecognized `toJSON` methods are refused before they can influence the immutable original, suggested service candidates, or a previously stored review. Candidate and selected-index arrays must be dense, ordinary arrays without hidden metadata, accessor-backed elements or extra keys. These checks run on both initial extraction and later direct review/preview, including unselected suggestions. Normal exact-source typed notes and confirmed transcript reviews remain valid. Tests explicitly assert malicious accessors never execute. Hashes remain **consistency-only**, and the adapter does not prove authenticated tenant membership, approved pricing, storage safety or authorization.
