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
