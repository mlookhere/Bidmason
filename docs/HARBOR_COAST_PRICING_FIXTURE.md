# Synthetic Harbor Coast pricing policy — development-only fixture

The original 2026 Harbor Coast proposal is preserved byte-exact in the source archive but **not approved for sending**. Its rates conflict with the client's stated `$450 minimum job fee`.

`lib/pricing.ts` supplies the pure integer-cent calculation used in this fixture: **base + applicable heavy-condition surcharge → eligible discount → re-enforce minimum on each displayed unit → multiply by quantity**. No routine can silently waive a minimum. No tax, law, margin or customer-specific contract decision is inferred.

| Example | Historical | Corrected formula result |
|---|---|---|
| Studio, as needed | $400 | $450 ($50 minimum adjustment) |
| Studio, reserved 10% | $360 | $450 ($90 minimum adjustment) |
| 1BR, reserved 10% | $450 | $450 |
| 2BR, reserved 10% | $540 | $540 |
| 1BR heavy, as needed +40% | $700 | $700 |

**Archived example, not a business default:** This original painting scenario has contradictory quarterly touch-up language: included versus separately billed. The synthetic QA fixture deliberately leaves the service **pending/non-quotable**, and the PDF states **“Terms pending owner approval”**. Neither $450 nor $475 applies to other organizations or represents an approved current offer. As the platform serves many types of companies, its price policy must be configured per company. No one is required to choose the old demo's quarterly price to complete internal QA; if that actual customer-specific service is later proposed, a verified owner must authorize either inclusion or a charge. `validateQuarterlyTouchUp(true,47500)` remains an important safety regression.

This work does not make the historical PDF safe. The original PDF has checkbox/word-wrap defects and contains unverified claims, and the marketing/demo forms are not persisted. Those remain blocked separately under Issue #3.

## Multi-company regression coverage

`lib/company-pricing.ts` adds an independent **pure, non-production** rule evaluator. The painting fixture uses a per-line minimum while a fictional office-cleaning fixture uses a quote-level minimum; each supplies its own catalog, units, surcharges, discounts, billing decisions and calculation order. A service with `billing: "pending"` causes a hard failure when requested; the evaluator never infers included/free versus billable. Such a test **does not grant quote approval**. The authenticated tenant-owned policy store, per-company tax/margin rules, durable versioning and production rendering/approval flow remain work for later slices.
