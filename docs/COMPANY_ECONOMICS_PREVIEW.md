# Item 4 — versioned company-specific quote economics (pure preview)

`lib/company-economics.ts` extends the existing exact-cent
`quoteFromPolicy` **without mutating its historical regressions**.

Inputs come from a versioned, organization-owned policy selected by a
trusted caller (authentication and owner approval are NOT implemented
here). `previewCompanyEconomics()` applies configured service
exclusions, calls the reviewed pricing engine, optionally applies a
nonnegative company-configured **exclusive whole-quote tax rate** after
minimum adjustments, and optionally estimates gross margin from
explicit direct-cost cents for every requested service. Costs include
an included-but-not-free-to-deliver service; taxes are excluded from
gross-margin revenue. Invalid, negative, missing, duplicated or
overflowing configurations fail closed. All monetary arithmetic uses
safe integer cents and BigInt half-up rounding where needed.

The policy revision and configuration fingerprint are retained with
the preview. SHA-256 is a consistency fingerprint, **not a digital
signature, authenticated approval, tax-compliance determination or
customer-usable quote**. Unknown/excluded/pending service terms remain
unquotable. The whole-quote tax choice is intentionally narrow:
item-exempt tax allocations, inclusive tax, jurisdictional law and
tax treatment of mixed service minimums require separately specified
company policy and must not be inferred.

No customer-facing intake, quote, payment or sending endpoint is
enabled. The module is independent of Item 3's deferred Auth/RLS PR.

Regression coverage: `tests-web/company-economics.test.mjs`.

## Optional service add-on acceptance and large-cent arithmetic

A company may mark a catalog entry `optionalAddon: true` (no platform
default). A line with that marker can appear in a quote **only** with an
explicit `addonAccepted: true` from the human review workflow.
`previewReviewedEconomics(..., acceptedAddonCodes)` requires each
acknowledged add-on to be both selected from the exact original and marked
optional in the current company policy; duplicates, arbitrary codes and
model-origin suggestions without the separate acknowledgement fail closed.
The selected-line fingerprint also includes the add-on acceptance.
The API remains `preview-only`, with no durable reviewer signature.

Surcharge and discount arithmetic now uses BigInt intermediates with
safe-cent output bounds. This avoids rejecting legitimate, high-value
contracts solely because multiplying by basis points exceeds JavaScript
safe-number range even when the final cent result is representable.
Regression coverage spans exact reviewed add-ons, direct-cost and tax
calculation, malformed company policies and large-cent rounding.

## Canonical quote-line request boundary

The shared `snapshotQuoteInputs` preflight is now used by both the direct
company pricing calculator and the versioned economics preview. It rejects
sparse, accessor-indexed, decorated or custom-prototype line collections,
as well as getter-backed, hidden, inherited or extra fields on requested
line objects, **before** exclusion checks or arithmetic. Only exact,
enumerable, plain-data lines are copied into detached quote inputs.

The company-specific exclusion decision still runs before attempting to
price a prohibited service, including a pending/unknown commercial term.
Positive authorized plain/null-prototype line objects remain supported.
This is a pure data-integrity guard, not evidence of authenticated tenant
approval or customer delivery permission. Company policy versions, human
review, tax law and live Supabase acceptance remain separate requirements.

## Inert company-owned ratecards in the standalone calculator

The direct `quoteFromPolicy` path now snapshots its **entire caller-provided
company ratecard** with the existing canonical company policy serializer
before examining currency, minima, services, discounts or surcharges.
Nested getters, hidden/symbol keys, custom `toJSON` methods, unsupported
prototypes and nonintegral policy amounts are rejected before pricing.
Ordinary plain and null-prototype configuration records remain supported.

This aligns offline direct pricing with the canonical-data requirement
already enforced by versioned economics and policy fingerprints. It does
**not** prove that a ratecard has an approved revision or that its caller
belongs to the company; trusted current-tenant policy lookup and separate
approval checks remain necessary before any commercial use.

## Optional add-on consent is inert, not a price override

The standalone `previewReviewedEconomics` now validates the human-provided
`acceptedAddonCodes` collection **before** reading any acknowledgement
element. It only accepts a dense, ordinary, undecorated array of at most
50 primitive service codes. Hidden, symbolic, inherited, sparse and
getter-backed acknowledgement values fail closed without running getters.
The accepted codes are copied into a private array, then checked for
existing selected services, canonical ordering and current-policy
`optionalAddon: true` entries.

The company policy is canonicalized and snapshotted with the shared
company-policy serializer **before** the add-on flags are consulted, and
that same snapshot drives the deterministic economics calculation.
A forged ratecard getter or custom serializer cannot manufacture an
accepted optional service or change the calculation after a consent check.
Regression tests live in `tests-web/intake-quote-preview.test.mjs`.

A true human acknowledgement remains an independent reviewed action in
the authorized workflow; accepting a data-only array is never a
signature, an approval, a proposal or permission to contact customers.
