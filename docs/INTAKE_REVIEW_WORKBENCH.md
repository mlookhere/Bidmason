# Item 4 — Internal extraction review workbench (unwired)

The first reviewer-facing UI contract consists of:
- `lib/intake-review-workbench.ts`: pure source-bound review model,
  selection state machine, add-on acknowledgement and preview payload checks.
- `components/IntakeReviewPanel.tsx`: accessible client-side presentation with
  service checkboxes, verbatim extracted excerpts, separate optional add-on
  acknowledgements, disabled pending/excluded/unlisted services and a
  preview-request control.
- `tests-web/intake-review-workbench.test.mjs`: adversarial model and
  selection regression tests for stale documents, pending terms, exclusions,
  duplicate services, unacknowledged add-ons and reset semantics.

**Integration is deliberately OFF.** The panel is NOT routed from the public
landing page or configured as an API endpoint. Without an explicitly supplied
internal preview callback, its preview button is disabled. Even with a caller,
the output is only selected indexes, accepted optional service codes and a
consistency key. There is no approval, quote dispatch or customer communication.

Model creation uses verified original text/candidate spans and a caller-supplied
policy. The caller must be a trusted authenticated backend selecting the current
approved tenant policy; its SHA-256 key is not an authentication signature.
The future internal preview callback must recompute exact source/policy/review
under fresh tenant membership checks via `previewAuthorizedReviewedEconomics`.
The client cannot make a quote send-ready. Local UI flags do not constitute
customer acceptance, and any eventual send requires a separately authorized
immutable approval transaction.

Nothing here enables customer evidence uploads/downloads, billed services,
subscriber authentication, storage persistence or marketing-site capture.
Item 3's genuine multiuser Auth/Storage/security release gates remain deferred
but mandatory.

Browser/server separation: `IntakeReviewPanel` imports runtime selection
helpers only from `lib/intake-review-selection.ts` (no `node:crypto`).
Source and policy hashing remain server-only in
`lib/intake-review-workbench.ts`. The latter re-exports selection helpers
for backwards compatibility with existing pure Node tests. The panel still
has no public route or automatic network request.

## Pre-selection economics eligibility (October 2026)

The internal review model evaluates each otherwise selectable, approved service through `previewCompanyEconomics` using the exact extracted quantity and an *evaluation-only* optional add-on acknowledgement. This does **not** grant optional consent: the real review selection still requires a separate human acknowledgment. If declared direct costs for that line are absent, percent/cents math is invalid or overflows, or the configured tax cannot be safely evaluated, the row is `invalid` and cannot be selected. Pending, explicitly excluded, and unlisted services retain their own blocked statuses. Missing **all** direct costs remains a visible unverified-margin condition in later economics, rather than a fabricated cost or a silent approval. The check is per line; the full selected bundle is independently recalculated before any internal preview. No public integration, authorization or outbound action is added.

## Inert policy and extraction-evidence boundary

The standalone server-side `buildReviewWorkbench` now validates and detaches
the complete supplied company policy using the same canonical serializer
used for policy revision fingerprints **before** examining any ratecard,
service or exclusion field. It rejects accessor-backed values, hidden and
symbol fields, inherited prototypes and custom serialization without
executing application-supplied getters.

Before enumerating extraction candidates, the workbench also uses the
shared immutable-source and reviewed-candidate validator to check the
original text, candidate collection, source/candidate digests and exact
provenance. Its index-zero probe validates evidence only: it is neither a
human service selection nor optional add-on acknowledgement. Invalid
inputs cannot become selectable rows; valid policy records and verified
review evidence retain their prior per-line availability semantics.

These checks are internal data-integrity defenses. The workbench remains
**unwired and non-sendable**. Neither the fingerprint nor the validation
proves a real current tenant membership, approved company ratecard, or
reviewer authorization. Those decisions still require the trusted
tenant-owned backend and the separate live staging acceptance gates.
