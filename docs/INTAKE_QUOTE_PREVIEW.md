# Item 4 — human-reviewed economics composition

`lib/intake-quote-preview.ts` joins the bounded extractor's
exact-source review to `previewCompanyEconomics()`, without importing
the deferred Item 3 Auth/Storage code. The existing review validator is
factored into `selectReviewedServices()` so **both** the legacy
basic quote and the new company-economics path enforce the same original
source SHA-256, candidate snapshot checksum, valid units and explicit,
unique human-selected candidate indexes.

`previewReviewedEconomics()` returns only `preview-only` data. It
keeps selected source offsets, original source and candidate hashes,
versioned policy hash and a deterministic selection fingerprint. The
source text itself and proposed model-origin prices/approvals are not
exposed as pricing inputs. Changed company revisions, selected
quantities and original evidence all invalidate the previous fingerprint.

The hash is a consistency checksum, **not** a backend signature. This
code does not authenticate reviewers, store originals, approve policy
revisions, create tax law, publish or send a quote. Those remain
server-owned Item 3/4 integration and release gates. No customer-facing
intake endpoints are enabled.

`tests-web/intake-quote-preview.test.mjs` covers revised policies,
explicit selections, pending/excluded services, stale/tampered sources,
and failed transcript inputs.
