# BidMason — Company-configurable commercial workflow

## Product direction (confirmed by the project owner, October 2026)

**One secure platform; many contractor-defined operating models.** Harbor Coast Painting, including its $450 floor and $475 quarterly service, is historical **synthetic regression data**, not BidMason's default business model, target segment or commercial price list. The platform must support cleaning, painting, landscaping, pressure washing and new service verticals without rewriting the application for every customer.

### Per-organization configuration (future production model)

| Configuration area | Company-specific inputs | Shared platform responsibility |
| --- | --- | --- |
| Identity and branding | Company name, artwork, contact details, approved credentials | Verified business facts, signed revisions and approved templates |
| Services and units | One-time work, labor hours, sqft/area, visits, rooms, frequency, optional extras | Structured service catalog, normalized units and calculations |
| Pricing | Rate cards, schedules, discounts, surcharges, minimum scope/order, taxes/margins | Exact minor-unit arithmetic, no implicit charges, validated policy versions |
| Service packages | Included, separately billed, conditional, unavailable | Unknown/pending term stays unquotable; no contradictory included+charged output |
| Proposal | Terms, exclusions, warranty language, pricing options, brand styling | Reusable renderer and strict publish/review gates |
| Commercial process | Required site inspection, owner sign-off, additional reviewers, contact cadence | Configurable but auditable workflow states and authorization |
| Operations | Client portal, reminders, CRM fields, notifications, billing entitlements | Tenant isolation, observability, retries, compliance and access reviews |

**Guiding principles:** Configuration over hardcoding; rule validation over generative price guesses; organization-controlled rates and approvals; version every published policy; separate product defaults from tenant choices; support extension points for unusual industries without permitting arbitrary executable scripts in pricing or RLS.

### What currently exists

The **experimental**, pure `quoteFromPolicy()` in `lib/company-pricing.ts` consumes an explicit service catalog with quantities, charged/included/pending flags, service prices in integer cents, configured calculation order, and either no minimum, per-line minimum, or quote-level minimum. It neither embeds a company's price list nor fetches tenant data. Unconfigured services are rejected; pending commercial terms cannot be converted into a quote. It deliberately does **not** implement taxes, time/area unit conversions, contract-specific exceptions, policies from the live database, or customer sending. That is Step 4+.

The **historical** `lib/pricing.ts` unit pricing and `fixtures/demo_snapshot.json` remain for regression proof and PDF QA only. Keep the old $450 floor and $475 conflict tested to avoid restoring their bugs, but never require the business owner to pick one historic fictional quarterly term in order to pass Step 2.

### Production safety boundary

Pricing policies must be loaded using the current authenticated tenant membership and immutable approved configuration version; **never trust a client-supplied organization ID or pricing overrides**. Changes to pricing, proposals, credentials and sending requirements must be versioned, reviewed and authorized by appropriate tenant roles. A derived price is not itself approved for delivery. Incomplete or contradictory conditions must be flagged and excluded from any finalized quote instead of defaulting to zero or an invented amount.

**Scope:** Step 2 confirms fixture correctness, quarantine and multiple configuration profiles. Steps 3–5 implement real tenant-owned config persistence, typed extraction, flexible pricing and branded proposals. Steps 6–8 add controlled customer sending, portal, operations and pilot validation. No customer workflows are enabled by this planning decision.
