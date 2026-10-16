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

**Unresolved operator decision:** Does the Full Property tier include the quarterly $475 touch-up day at no additional charge, or bill $475 each visit? The historical proposal says both. `validateQuarterlyTouchUp(true,47500)` rejects the contradiction, rather than picking a price. The live PDF fixture now displays **“Terms pending owner approval”** instead of simulating inclusion at $0. It must not be treated as an owner-approved revised offer until this choice is explicitly recorded.

This work does not make the historical PDF safe. The original PDF has checkbox/word-wrap defects and contains unverified claims, and the marketing/demo forms are not persisted. Those remain blocked separately under Issue #3.
