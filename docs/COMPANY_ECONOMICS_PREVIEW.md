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
