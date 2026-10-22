# Item 6 — Synthetic buyer portal read/response review

**Status: offline fictional verification only — no buyer portal, file access, live Auth, response submission, proposal acceptance, persistence, or provider notification.**

`lib/synthetic-buyer-portal-review.ts` composes the existing `verifyBuyerViewGrant` and `assessBuyerResponseDraft` pure functions, without exposing either underlying token, grant ID, document, buyer identity or response text.

## Scope and behavior

- A signed view grant is scoped to exact tenant, proposal, immutable revision, recipient hash and content hash, with a 15-minute maximum in the underlying issuer. The signed proof **does not authenticate the human buyer** or authorize reading any PDF; validation against an active organization membership, a durable revocation record, actual request identity and current approved content is not implemented here.
- When only a grant is provided, the result is `view:"signed-claims-only"`, `response:"not-requested"` with `contentAccessible:false`.
- A supplied fictional question, request-for-changes or decline passes through the strict nonbinding response-draft validator. It can return `response:"draft-internal-only"` but can **never** return `responseSubmitted:true`. It rejects any `accept`, `approve`, submit, or send response kind.
- An expired, future, revoked, forged or wrong-tenant/revision/recipient/content grant returns a **blocked** state, never a fallback view. A grant already in the caller-supplied response history cannot be replayed to create another synthetic draft.
- A malformed, sparse, getter-backed or incomplete response-history array **fails closed even when no draft was requested**. This is in-memory input validation, not proof of durable revocation or uniqueness.

The returned object contains only fixed, privacy-safe state strings and invariant booleans. It always reports `state:"portal-simulation-only"`, `contentAccessible:false`, `responseSubmitted:false`, `contactAuthorized:false` and `dataComplete:false`.

## Verification

`tests-web/synthetic-buyer-portal-review.test.mjs` tests signed-claims-only behavior, simulated drafts, disallowed approvals, expired/revoked/wrong-identity token denial, simulated response replay, invalid text and malicious history arrays. Include the unchanged web-build, native Windows and all required SHA-matched PR/Actions jobs before claiming code acceptance. Do **not** add this module to any live route, server action, shared layout or the public fictional lab; the Item 6 runtime-boundary guard intentionally treats `lib/synthetic-*` modules as offline-only.

## Release blockers

Before any genuine buyer view or response, implement and independently verify tenant-authorized issuer access, authenticated buyer identity, CSRF defenses, durable grant revocation and replay prevention, exact approved proposal revision, private PDF access checks, safe response persistence, audit history, retention, security/privacy/legal review and an authorized go/no-go. The existing H10 buyer-access requirement and all other H01–H13 requirements are **unverified**. No customer contact or release authorized.
