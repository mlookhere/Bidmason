# Item 4 — Trusted company pricing persistence contract

`lib/company-policy-service.ts` provides the integration boundary between the
pure, versioned company-pricing domain and future authenticated persistence.
It introduces **no live database tables, HTTP endpoints or customer access**.

A production `TrustedPolicyStore` **must** perform the following atomically on
its server-owned backend:

1. Derive the actor from the verified current session; never accept a caller-
   supplied actor ID, role, company ID or price override as authority.
2. Authorize current membership, tenant and the `draft` or `review` action
   **inside the same transaction and write snapshot**, so a queued request
   cannot succeed after an access revocation.
3. Apply the pure domain transition to the current scoped policy history,
   enforce expected revision **and SHA-256** with a database compare-and-swap,
   and durably commit the entire new version or none of it.
4. Read only the authenticated company's history. Each `readAuthorized` must
   revalidate membership and current visibility independently. Missing,
   malformed or unsigned policy histories fail closed.
5. Guarantee revision immutability and durable auditing. The pure SHA-256 is
   only a consistency fingerprint; it does not authenticate who approved a
   rate, replace RLS, sign a revision or make it ready to send.

`submitCompanyPolicyDraft` and `reviewCompanyPolicyDraft` derive actors only
through that trusted port, without client identity fields. `previewAuthorizedReviewedEconomics`
reads an approved policy (never a client-supplied rate override), applies the
previously verified source-bound human selection, and reauthorizes before
returning a **preview-only** result. It fails when the active revision changes
between reads or membership was revoked. A future send/publish request must
independently reauthorize and revalidate exact policy, source and proposal
revision in its own transaction; a preview cannot serve as send approval.

The test suite implements an intentionally ephemeral in-memory **mock port**
to verify these requirements, including two concurrent submissions and
revocations during a queued transaction or preview. The mock is not exported
as a backend implementation. Neither successful mock tests nor isolated CI
fulfil Item 3's deferred signed-in PostgREST/Storage and RLS acceptance.

This isolated Item 4 branch remains unmerged. Do not deploy these prototypes
on real clients, store credentials in the repository, invent an Auth policy or
enable any customer-facing intake, downloads, payments or quote sending.
