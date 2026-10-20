# Item 4 — Read-only internal proposal draft preview

`lib/authorized-proposal-draft.ts` composes the existing tenant-owned
extraction, committed human scope-review, and active approved company ratecard.
It is **internal and unrouted**, not an HTTP endpoint, publishable proposal,
quote acceptance, customer approval, or send.

The caller supplies only tenant and source UUIDs, never a source body, model
output, reviewer identity, prices, rates, or approval flags. The source and
company policy stores must each verify the active session and tenant ownership
on EVERY read against authoritative primary state.

The service requires an existing `reviewed-for-proposal-draft` decision and
the immediately preceding extraction audit. It recalculates the exact service
selection, optional add-on acknowledgements, quote minimum, tax and margin
from the immutable original and active company-approved policy. It matches
the entire stored human review (actor UUID, source/extraction hashes, selected
indices, policy revision/hash and selection fingerprint) rather than trusting
stored amounts or a browser-provided checksum.

Two fresh authorized source reads and two current-policy reads detect
observable revocations, source changes, altered audit, policy rotations and
stale company rates. The output is always `state: "preview-only"` with
`purpose: "internal-proposal-draft"`; the SHA-256 consistency identifier
is NOT a cryptographic signature, permission, publish approval or send token.

A future proposal transition MUST take an independent approved company
brand/template/terms, verify owner consent and revision-bound approval, and
reauthorize source + policy + recipient **in one protected transaction**.
No direct quote/email/PDF delivery, billing, customer upload, or publication
was enabled. This helper depends on trusted adapters not yet implemented;
passing mock tests cannot replace Item 3's genuine Supabase Auth/RLS, private
Storage bytes/AV, abuse/retention and security acceptance.
