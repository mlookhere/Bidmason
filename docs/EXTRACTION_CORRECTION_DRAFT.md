# Item 4 — Internal human correction of extracted service candidates

**Status: pure, offline, unpersisted review draft — not an authorized mutation.**

`lib/extraction-correction-draft.ts` implements a missing-data/correction
contract when an extractor proposes the wrong service, quantity, or omits a
source-backed service. It does **not** replace the original provider extraction.

A reviewer may explicitly **replace** an existing candidate, **remove** an
unsupported candidate, or **add** a missed source-backed candidate. Every
action must have a bounded human explanation. Each new/replaced candidate
must still satisfy the same strict code, integer-unit and exact UTF-16 source
excerpt/span rules used for model extraction. The entire original source and
all originally extracted candidates must verify before any draft is built.
The draft cannot contain an empty scope, a duplicate service code, or more
than fifty proposed services; unsupported directives and accessor properties
are rejected. Changes are normalized in source-index order; additions are
sorted by source location. Input action order cannot change the digest.

The returned `awaiting-authorized-extraction-correction` object includes
original and proposed candidates SHA-256 consistency fingerprints, the
correction fingerprint, bounded reasons, and before/after audit evidence.
It deliberately does **not** contain `ExtractionReview.state`, an approval,
a user identity, a quote, or permission to send. It does not mutate the
provided review or install corrected candidates in durable tenant storage.

**Production prerequisite:** a trusted service must authenticate the reviewer,
reread the exact original source and unchanged provider extraction from
tenant-owned persistence, compare current revisions and fingerprints inside
an atomic transaction, record an immutable correction audit, invalidate any
prior reviewed scope, and separately require human selection against the new
provenance-backed review before previewing or drafting a customer proposal.
Existing extraction/scope database rules cannot be bypassed by passing this
draft to preview helpers. No customer upload, public route, external model
call, or deployment is enabled. Item3 live Auth/RLS/private Storage, signed
AV, retention, approval and security release gates remain open.

`tests-web/extraction-correction-draft.test.mjs` proves validated edits,
omissions and removals, unmodified originals, stable correction digests,
stale evidence rejection, explicit reasons, malformed candidate rejection
and prevention of getter/extraneous-authorization fields.
