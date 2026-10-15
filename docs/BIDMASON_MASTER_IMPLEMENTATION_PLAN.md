# BidMason — Master Implementation Blueprint

**Document ID:** BM-PLAN-001  
**Version:** 1.0  
**Prepared:** 2026-10-14  
**Status:** Proposed roadmap; not evidence of completed implementation  
**Source baseline:** User-provided `bidmason.zip` snapshot, with artifacts predominantly dated 2026-06-10/11  
**Intended location:** ChatGPT Project Sources / project repository `docs/`  
**Companion source:** `BIDMASON_EXECUTION_TRACKER.md`

> **How to use this source:** Treat this document as the proposed implementation contract. Before performing work, inspect the actual latest project/repository state; confirm applicable architecture and decisions; use the companion tracker to select the next unblocked task; implement and test one coherent vertical slice; record evidence and update the tracker. **Do not infer that a planned feature exists.** The uploaded archive is a baseline snapshot, not proof of deployed services or a current GitHub branch.

---

## 1. Executive direction

### 1.1 Product mission

BidMason helps commercial-service contractors win, fulfill, and retain larger contracts. Its central workflow is **walkthrough notes → verifiable scope and pricing → contractor-approved, branded proposal → tracked delivery and follow-up → outcome reporting**. Supporting products include high-quality contractor websites, intake, outreach materials, CRM-lite, and a lightweight proposal-view/acceptance portal.

Keep the existing **service-business-first, software-platform-later** strategy. The early product should make one operator effective with multiple paying contractor clients before it becomes a self-service SaaS.

### 1.2 Guiding constraints

1. **Accuracy ahead of autonomy.** AI drafts, summarizes, and identifies possible issues. Typed validation, deterministic math, permissions, and explicit approvals control actions.
2. **No unapproved customer-facing action.** Website deployment and proposal/email delivery require their designated approvals. Approval is a recorded event against a specific, immutable revision.
3. **Single source of truth.** Operator-approved contractor facts, pricing rules, policies, and evidence live in structured, tenant-scoped records. Human-readable briefs are generated/approved views of those facts, not unsynchronized parallel databases.
4. **KISS / YAGNI / DRY / SOLID.** One app and one database first; small modules with single responsibility; one pricing engine; one claims-verification rule; one QA results model. No microservices, elaborate autonomous-agent graph, event bus, or speculative multi-tier infrastructure for MVP.
5. **Preserve the current business positioning.** Lead with tangible contractor outcomes, not technical buzzwords. Avoid misleading or false claims about how services are delivered; make legally required disclosures and respond truthfully to direct questions about AI involvement.
6. **Be honest about evidence.** Simulated demo data, customer-supplied claims, independent verification, missing fields, assumptions, and actually tested behavior are different statuses.
7. **Market validation matters.** Commercial cleaning is the initial niche; pressure washing and landscaping follow validation. The Harbor Coast Painting demo is a technical test case, not proof that cleaning-market fit is established.
8. **Cost of operations is a product constraint.** Monitor model cost, PDF rendering time, email delivery, storage, human QC minutes, hosting, and client support burden before expanding scope.

### 1.3 What constitutes an MVP

A contractor can create an approved business profile and pricing library, upload or paste walkthrough notes, review extracted scope and missing facts, generate a correctly priced branded PDF, receive risk/QA findings, approve the exact proposal revision, send it with confirmed provider acceptance, observe status, and stop follow-ups after customer responses. The operator can view the approval queue, failed jobs, activity, and basic pipeline metrics. Tenant separation and auditability are part of MVP, not later add-ons.

A polished marketing website and a client-specific website template may coexist, but neither needs a full page-builder/CMS in the first release.

---

## 2. Baseline inventory and observed gaps

The uploaded archive includes:

- `README.md` documenting the business model, nine departments, six production steps, and two-layer service/software strategy.
- `agents/01-market-analyst.md` through `agents/09-account-analyst.md`: nine **instructions/prompts**, not independently deployed agents or running services.
- `operations/`: intake, packages and pricing, QC, proposal templates, follow-ups, reporting, hiring, and a prior 90-day launch plan.
- `sales/pitch-and-outreach.md`: outreach playbook.
- `bidmason-website.html`: a standalone marketing site with an illustrative form.
- `demo-clients/harbor-coast-painting/`: synthetic brief, positioning, demo website, walkthrough note, proposal Markdown and PDF, risk review, follow-up sequence, QA report, monthly report, and `make_proposal_pdf.py`.

### 2.1 Confirmed defects from the audit

| ID | Observed issue | Evidence in supplied snapshot | Required disposition |
|---|---|---|---|
| DEF-01 | Marketing lead form reports success without persisting a lead | `bidmason-website.html`, `leadForm` handler near lines 724–738 | Connect to server, validate, persist, notify; success only on confirmed save |
| DEF-02 | Contractor demo site form reports success without creating a request | `04-website-harbor-coast.html`, `propForm` handler near line 374 | Same server-side form behavior as DEF-01 |
| DEF-03 | Unit-turn prices violate the stated $450 minimum | Client Build Brief states $450; proposal shows studio $400, volume studio $360 | Enforce minimum unless an explicit authorized exception is documented |
| DEF-04 | Full Property Program quarterly touch-up described as both included and an additional $475 per visit | Demo offer/proposal pricing language | Define inclusive/exclusive scope and total charges unambiguously |
| DEF-05 | PDF shows damaged checkbox characters and poor pagination | Generated demo four-page PDF; generator uses font/glyph and split table flowables | Fix glyph/font strategy and table keeping; add visual PDF checks |
| DEF-06 | Credential claims are displayed without supporting verification | Brief flags license, COI and RRP evidence outstanding; website and PDF cover contain claims/number | Block external claim publication until verified or remove claim |
| DEF-07 | QA report says pricing/math and PDF are clean despite unresolved defects | `09-qa-report.md` compared with original deliverables | Require independently executed, evidence-backed QA checks |
| DEF-08 | Product modules are described as existing but their running implementations are absent from archive | README and website describe CRM, portal, automated follow-up; archive contains no matching backend/app | Implement, or mark as manual/planned; do not sell nonexistent capabilities as live |
| DEF-09 | Contractor mobile navigation disappears on narrow screens | Demo contractor site CSS hides `.nav-links` below 880px without replacement | Add accessible mobile navigation |
| DEF-10 | Prospect quote attachment is requested but no upload input exists | Marketing copy vs. existing contact form | Add upload where data collection policy, storage, and malware/type limits support it |

**Important:** A static-file review does not establish uptime, production security, deliverability, actual conversion, or repository history. Verify all of these against live systems if/when they exist.

---

## 3. What to build, what to postpone

### 3.1 Required through production MVP

- Contractor organization onboarding, membership, and approved canonical business profile.
- Server-backed lead intake and optional secure attachments.
- Transcription of recordings and text-note ingestion.
- Structured extraction with provenance, confidence/uncertainty, and questions.
- Deterministic pricing and policy checks.
- Proposal drafting, versions, PDF generation and rendered-document QA.
- Risk-review flags and mandatory approval workflow.
- Proposal send, email delivery events, simple follow-up scheduling/suppression.
- Minimal CRM stages and proposal activity history.
- Tenant-scoped access, deletion policies, observability, automated tests.

### 3.2 Deliver manually or in lightweight form first

- Contractor website design and launch approval: static, reusable template plus human publishing review.
- Sales/industry copy and outreach collateral: approved templates with human editing.
- Monthly reports: automatically aggregate available metrics into an operator-approved one-page report.
- Customer proposal view: read-only link plus explicit decision/response; avoid legal-signature promises until reviewed.
- Billing: simple Stripe subscription + setup invoice/webhook record after real paid-client onboarding needs it.

### 3.3 Explicitly deferred until warranted by usage

- Visual page-builder, generalized component marketplace, enterprise SSO, native mobile apps.
- A nine-service autonomous multi-agent runtime; distributed queues/event streaming; multiple AI provider fallbacks everywhere.
- Full contract lifecycle management, legally binding e-signature suite, contractor bookkeeping/payroll/invoicing.
- Automatic unsupervised proposal sending, unreviewed pricing changes, unsupervised contractor site deployment.
- Broad multi-trade expansion, speculative AI scoring/forecasting, advanced SEO content farm, arbitrary integrations.

**Expansion rule:** A deferred feature requires a named user problem, usage evidence, operator cost or revenue impact, a smallest viable design, and an explicit decision in the decision log (§19).

---

## 4. Actors, permission boundaries, and user journeys

### 4.1 Roles

| Role | Allowed | Cannot do without additional authority |
|---|---|---|
| BidMason platform admin | Manage platform configuration and billing operations; access scoped support workflows | See customer data casually or bypass audited access controls |
| BidMason operator/reviewer | Manage assigned contractor accounts, correct drafts, perform QA, approve site publication and operator-side proposal review | Impersonate contractor acceptance without authorization |
| Contractor owner/admin | Approve own business profile, claims submitted as evidence, pricing exceptions, proposal sends, team memberships | Access any other contractor tenant |
| Contractor staff/editor | Capture notes, edit drafts and records within configured permissions | Override minimum pricing or send without approval unless explicitly delegated |
| Prospect/customer | View specifically shared proposal and submit responses on tokenized link | Explore other proposals, internal notes, source inputs, other tenants |
| System worker | Process permitted stages against service-level policies | Treat a prompt or file as approval, or access unrestricted tenants |

An operator should be granted tenant access through an auditable support/assignment relationship; a global service key must never be exposed to browser clients.

### 4.2 Primary happy-path journey

1. Contractor completes intake; system creates tenant-scoped draft profile.
2. Operator checks legal name, offerings, service area, pricing basics, and verification claims; contractor confirms their pricing rules; resulting profile revision becomes **approved**.
3. Contractor uploads a recording or past quote / enters walkthrough notes.
4. System safely stores input; extracts text and field-level evidence; marks uncertainty and missing quote blockers.
5. Reviewer/contractor corrects extraction; system calculates candidate options from approved pricing rules only.
6. A single branded proposal revision and internal risk/QA report are generated.
7. Operator closes blockers, runs QA, and approves that immutable revision.
8. Contractor confirms the exact recipient, prices, scope, and revision and authorizes send.
9. Email provider accepts the message; proposal event becomes `sent`; deliverability/reply status updates independently.
10. Follow-ups are scheduled within policy and automatically suppressed by reply, bounced address, opt-out, withdrawal, acceptance, or manual pause.
11. Pipeline updates, reports, and future estimates use actual events, not speculative counts.

### 4.3 Important exception paths

- **Audio unreadable:** retain the source, report transcription failure, request text/manual notes; never fabricate missing scope.
- **Insufficient scope:** enter `needs_information` and ask targeted questions; no final quote.
- **Unknown license/COI/RRP:** remove outward-facing claims or block publishing; never infer verification from client self-report.
- **Below-minimum quote:** blocking error or one-time, documented contractor-owner exception with reason, scope, expiry and actor.
- **Email sent but provider rejects delivery:** record `bounced`/`failed`, suppress follow-ups and notify operator; avoid silently retrying a different destination.
- **User edits after approval:** invalidate relevant approvals and QA results; require rerun against the new revision.
- **Link revoked or expired:** show safe invalid-link response, no data disclosure.
- **Worker retries:** use idempotency to avoid duplicate PDFs, sends, accepted proposals, or bills.

---

## 5. Target technical architecture

### 5.1 Default stack (prefer reusing an existing app if found)

- **Frontend/app:** Next.js with TypeScript, server actions/API endpoints where suitable, on Vercel; responsive accessible UI.
- **Database/auth/storage:** Supabase Postgres, Auth, private Storage, RLS, migrations; use Edge Functions only where they simplify webhook/secure execution.
- **AI:** one configurable transcription service plus one LLM integration for extraction/drafting; structured schemas and prompt versions. Avoid making every stage a separate model request.
- **Pricing/policies:** typed TypeScript domain module with server-side unit tests; authoritative results stored on a proposal revision.
- **PDF:** retain/refactor the existing ReportLab generator initially if it passes hosted execution and visual requirements. It consumes fully priced, validated input and performs **zero business pricing calculations**. Reevaluate a TypeScript/HTML-to-PDF solution only if deployment/maintenance justifies migration.
- **Email:** choose either Resend or Postmark for transactional messages after a deliverability spike; store provider event IDs. Do not implement both without a real need.
- **Scheduled work:** database-backed due jobs plus a cron/worker invocation appropriate to actual deployment. Do not introduce n8n unless operationally justified by cross-service workflows.
- **Billing:** Stripe Checkout/invoices and a verified webhook once paid onboarding is implemented; plan entitlements in the app's database, not in browser state.
- **Monitoring:** structured server logs, error reporting, event/job visibility, basic spend reporting.

### 5.2 Architecture sketch

```text
 Contractor browser / BidMason operator browser
                    |
             Next.js application
                    |
       Auth + tenant permissions + server validation
                    |
   +----------------+--------------------+
   |                |                    |
Supabase         Domain logic         Secure AI adapter
Postgres/RLS     - price rules         - transcription
Storage          - approvals           - extraction
                 - QA rules            - drafting
   |                |                    |
   +----------------+--------------------+
                    |
             Durable job records
                    |
       PDF renderer / Email sender
                    |
          Provider event webhooks
                    |
        CRM, follow-up, reporting
```

### 5.3 Module boundaries

| Module | Owns | Depends on |
|---|---|---|
| Identity/tenancy | authentication, membership, allowed tenant scope | Supabase Auth/RLS |
| Client facts/verification | approved profile, evidence, claims | identity/storage |
| Intake/transcription | inputs, transcript, fact extraction, provenance | facts, AI adapter |
| Pricing | decimal money math, minimums, discounts, margin checks, explanations | immutable pricing snapshot |
| Proposals | revisions, scope/tiers, rendering requests, link | intake/pricing |
| Approval/QA | policy checks, blocking findings, approval records | proposals/facts |
| Communications | sends, provider webhooks, recipient suppression, follow-up jobs | approved proposal |
| CRM/analytics | leads, stage history, won/lost outcomes, reporting | event facts |
| Website | public page template, verified claims, intake form, releases | facts/approvals |
| Billing/admin | Stripe status, entitlements, operator console | identity/events |

Each module should have a clear public interface. Avoid duplicating validation logic across React pages, workers, and prompts; server-side domain logic remains authoritative.

### 5.4 Proposed repository layout

```text
README.md
agents/                        # Existing role prompts; change only with tests/review
operations/                    # Existing business policies and approved templates
sales/                         # Existing sales playbook
demo-clients/                  # Clearly labeled synthetic cases
apps/web/                      # Next.js public site + logged-in app
packages/domain/              # Types, pricing, approvals, policy checks
packages/templates/           # Proposal/email/site templates and schemas
packages/ai/                  # Transcription, extraction, prompt versions
packages/testing/             # Test fixtures, PDF inspection helpers if needed
services/pdf/                  # Existing Python renderer only if retained
supabase/migrations/           # Versioned schema + RLS + indexes
supabase/seed/                 # Synthetic records only; never production PII
docs/                          # Architecture decisions, runbooks, this plan
.github/workflows/             # CI after repository is established
```

This is a **proposed** layout, not an instruction to force a monorepo if a working repository already exists. Inspect actual durable state before restructuring.

---

## 6. Data model and provenance

### 6.1 MVP entities (suggested physical tables)

| Entity | Core fields / behavior |
|---|---|
| `organizations` | `id`, `name`, `slug`, `status`, timestamps; one record per contractor tenant |
| `memberships` | `user_id`, `organization_id`, role, assigned reviewer support scope, active state |
| `business_profiles` | organization, structured approved facts, revision number, approval state, effective timestamp |
| `claim_evidence` | organization, claim type/value, evidence storage ref, source, verified-by/date, expiration, status |
| `pricing_rules` | organization, service, billing unit, rate, currency, min fee, discounts, surcharges, target margin, active dates, approval revision |
| `contacts` | organization, name, email, phone, company, communication consent/suppression flags |
| `properties` | organization, prospect, physical/site context, owner/contact, optional measurements |
| `leads` | organization, contact/property ref, source, status, submitted timestamp, assigned actor |
| `source_inputs` | organization, lead/property, input kind, private object key, hash, processing state, retention date |
| `transcripts` | source input, text/segments, model metadata, timestamps, uncertainty markers |
| `proposals` | organization, lead/property, number, current revision ref, lifecycle state, dates |
| `proposal_revisions` | proposal, immutable content snapshot, price breakdown, source evidence, QA status, PDF object path, content hash |
| `reviews_approvals` | revision or website-release ref, actor, kind, decision, timestamp, content hash, reason |
| `activity_events` | tenant, entity, actor, type, dedupe key, event data, time; append-only history |
| `email_messages` | organization, proposal/recipient, template revision, provider ID, delivery state, last event |
| `follow_up_jobs` | organization, message/recipient, due time, status, suppression reason, idempotency key |
| `site_releases` | organization, source revision/claim references, published URL, QA/approval hash, deployment status |
| `operational_jobs` | operation type, tenant, input hash, state, attempt count, next retry, failure reason |

MVP may combine small fields where justified. Do not flatten unrelated tenants into a global unscoped table. Keep verified evidence private while making appropriately verified public claim text available to site rendering.

### 6.2 Required cross-cutting fields

- Every tenant-owned row has `organization_id`, creator/updater or event actor, and timestamps. Foreign keys and compound indexes reflect tenant scope.
- Every externally published artifact records the `business_profile_revision`, `pricing_rules_revision`, `template_version`, and generated `content_hash` where relevant.
- Every significant event has a unique idempotency/deduplication key; retries must be safe.
- Money uses integer minor units or decimal-safe types with explicit currency, never floating-point business calculations.
- Unit measures are typed (square feet, labor hours, unit count, visits); do not mix quantities or derived totals.
- Personally identifying data and raw documents remain in private, access-controlled storage.
- Claims distinguish `client_stated`, `evidence_received`, `verified`, `expired`, `rejected`, and `unknown`.
- If source fact confidence is uncertain, preserve that uncertainty and cite the originating input (file/segment/field), rather than silently promoting inferred text into a verified fact.

### 6.3 Tenant isolation checklist

1. Enable RLS for every tenant-owned table and test both read and write denial for other tenants.
2. All private bucket paths and signed URL creation are scoped to authorized tenant users and allowed resource IDs.
3. Service-role credentials exist server-side only; verify authorization in server code even when using privileged database access.
4. Avoid trusting tenant IDs passed by the browser without checking user membership.
5. Support access is explicit, short-lived where possible, logged, and limited to assigned tenants.
6. Public proposal links use opaque high-entropy tokens, hashed at rest, with expiration/revocation/rate limiting and least-privilege read projections.
7. Never put sensitive pricing, internal notes, recordings, API tokens, or unverified credentials in publicly cached pages, logs, or analytics payloads.

---

## 7. State machines and approval enforcement

### 7.1 Proposal state model

```text
captured
  -> extracting -> needs_information <-> draft
  -> price_validated -> risk_reviewed -> qa_passed
  -> operator_approved -> contractor_approved -> send_queued
  -> sent -> delivered / bounced / delivery_failed
  -> accepted / changes_requested / declined / expired / withdrawn
```

Implementation may use **lifecycle state + independent delivery/decision status** instead of one enormous enum. That is preferable when `accepted` and `delivered` can legitimately coexist.

- No `price_validated` state while unresolved pricing blockers exist.
- QA must run on the final binary PDF as well as the source text before an external send.
- Operator approval and contractor approval each record actor, time, version/hash, and explicit scope.
- Changing price, scope, contact, claims, exclusions, terms, or render after approval invalidates affected approvals.
- Only a dedicated, server-side transition may enqueue external send after all gates pass.
- A provider acknowledgment means `sent` (accepted for processing), **not** necessarily `delivered`; only provider event confirms delivery.
- Acceptance is recorded as buyer intent and routed for authorized follow-up; do not automatically assert an enforceable contract without vetted terms/workflow.
- Record every transition in append-only activity events. Failed transitions return a specific reason.

### 7.2 Website release state

`working_draft → qa_review → operator_approved → deploying → published` or `deployment_failed`.

A release is tied to the checked commit/build hash and a verified claim snapshot. Editing content after signoff requires a new release review. A rollback target and publish evidence must be retained.

### 7.3 Approval decision matrix

| Activity | System may prepare | Operator approval | Contractor approval | Automatic execution after gate |
|---|---|---|---|---|
| Brief/offer revision | Yes | Required before activation | Business facts/pricing require contractor confirmation | Internal propagation only |
| Proposal draft/PDF | Yes | Required for early-stage close QC | Required for send | After both valid approvals |
| Price exception below minimum | Detect and propose | Required to review | **Owner/admin signoff required** | Only for explicit scoped exception |
| Client website publication | Yes | **Required** | Contractor approves business claims/content | Publish after approvals |
| Follow-up template change | Yes | Required on core template revision | Contractor tone/sequence approval | New sequence revision only |
| Standard follow-up due | Yes | Template already approved | Sequence already authorized | Yes, if recipient eligible and all guards pass |
| Report generation | Yes | Review before external send initially | Not generally required | Send after approval |
| Notifications/internal CRM write | Yes | Per initial release policy | No | Eventually automatic, idempotent |

---

## 8. Domain specifications

### 8.1 Intake and lead submission

**Fields:** contact name, email, phone optional, company, desired service, service location, estimated property/job context, desired timeframe, notes, referral/source and explicitly authorized file attachments. Collect only what is useful to return a quote or sample.

**Behavior:** client/server validation; field limits; honeypot and rate-limits; bot protection only as needed; spam quarantine; safe file types, size limits and malware scanning; server-side upload to a private bucket; persistence transaction and job enqueue; stable lead ID; notification to correct reviewer; human-readable errors and request re-submission guidance.

**Acceptance:** valid request produces exactly one tenant-scoped lead and at most one notification per dedupe key; invalid request produces none; simulated network/server errors do not show success; mobile keyboard, focus, error text, and accessible labels work; attachments are not exposed by public URLs.

### 8.2 Audio/note pipeline

1. Accept upload, typed notes, or pasted old quote. Store immutable original with checksum/source kind.
2. Transcribe audio with language/settings appropriate to the speaker; retain raw transcript and timestamped segments if available.
3. Extract **observations** separately from **requests**, **quantities**, **proposed scope**, **assumptions**, **exclusions**, **timing**, **buyer/contractor facts**, and **pricing hints**.
4. For every extracted material field, save text span/source, confidence or explicit uncertainty flag, and source note ID.
5. Resolve against the approved client pricing library and business profile; never use note text to override rate policy silently.
6. Show a single review screen highlighting unresolved quantities, unknown conditions, ambiguous details, site access, materials, safety/regulatory concerns, labor, and schedule dependencies.
7. Allow operator/contractor to edit extraction and record why; only the reviewed facts become quote inputs.

**Threat boundary:** Treat transcripts, PDFs, web copy, and attachment text as untrusted data. Source text cannot issue tool calls, change roles, approve proposals, or instruct public publication. Parse to structured schema; drop unsupported fields and log policy violations. Redact obvious secrets from AI requests when unnecessary.

**Acceptance:** ambiguous numeric speech (e.g. “fifteen” vs. “fifty”) is a `needs_information` blocker; unintelligible audio produces no inferred price; failed model call does not discard uploaded source; previously approved pricing is not overwritten.

### 8.3 Pricing engine

**Money and formula rules**

- Use exact decimal/integer-minor-unit calculations and documented rounding **at the displayed billing unit**.
- Input = measured quantity × approved base rate + authorized surcharges + optional scope; apply eligible discounts in the defined order; enforce service minimum and gross-margin policy.
- Store raw inputs, each line item's formula and evaluated value, discount basis, surcharge, minimum adjustment, currency, and final total. The PDF only displays this canonical snapshot.
- Discounts may change final per-unit prices; **recheck the minimum afterward**. A recurring program may define a different authorized minimum only with an explicit rule; never assume that a volume discount creates an exception.
- Gross margin = `(price - estimated direct cost) / price` when both amounts are known. If cost inputs are missing, say `margin not verified`; do not present a compliant margin score.
- Quote total is not the same as monthly expected value or annual run rate. Show scenario assumptions (unit mix, expected visits, billed extras, limits) next to every projected total.
- Currency and tax treatment are explicit per contractor, service, and jurisdiction; unknown tax treatment is a blocker or a clearly labeled excluded tax, per approved commercial policy.

**Mandatory test fixtures**

| Case | Input | Expected |
|---|---|---|
| HC-Min-01 | Harbor Coast studio standard $400, minimum $450 | Block or adjust according to approved policy; never silent pass |
| HC-Min-02 | Harbor Coast studio discounted 10% to $360 | Block unless specifically authorized minimum exception |
| HC-Min-03 | 1BR $500 discounted 10% to $450 | Meets $450 minimum |
| HC-Min-04 | 2BR $600 discounted 10% to $540 | Meets $450 minimum |
| HC-Heavy-01 | 1BR $500, heavy condition +40% | Canonical $700 before other allowed adjustments |
| HC-Quarterly-01 | Quarter touch-up marked “included” and line item +$475 | Reject as contradictory until scope/pricing are reconciled |
| HC-Margin-01 | Target gross margin 45% but direct costs unknown | Mark margin unverified, not passed |
| Generic-00 | Zero/negative qty, wrong currency/unit, expired rate | Validation failure |
| Generic-01 | Applied discount produces fractional minor units | Deterministic defined rounding and trace |
| Generic-02 | Exception approved for one named proposal revision | Does not grant blanket pricing exemption |

**Acceptance:** All numbers in the PDF, delivery email, CRM, and customer portal agree for the same proposal revision. Automated tests must cover minimums, discounts, surcharges, margin availability, installments/frequency, taxes, and exception expiry.

### 8.4 Proposal composer and renderer

A reusable proposal document model contains: contractor/prospect/property identity, verified credentials if applicable, date/validity, overview, trade-appropriate scope, completion standard, options, line items and price basis, scheduling, assumptions, exclusions, change-work handling, acceptance response, and internal note (never included in customer export).

- Start from the existing `operations/proposal-master-template.md`; separate presentation from facts.
- Create a tenant-branded PDF from structured content; preserve template revision, font, glyph and renderer versions.
- Handle long tables and sections without orphans; keep headings with content; prevent isolated last rows and split pricing options where possible.
- Use supported checked/unchecked UI graphics or embedded Unicode-capable fonts; no tofu/solid squares.
- Export both PDF bytes and their searchable/extracted text for automated checks.
- Generate deterministic proposal number and version labels; make revision identity visible internally.
- Render the **entire** document, including exact approved prices; no post-approval editing of PDF content.
- Acceptance wording must be reviewed for legal use; ordinary proposal acknowledgments and binding e-signatures are not interchangeable.

**Acceptance:** Harbor Coast's sample renders with no broken characters, cut tables, missing units, credential leakage, internal notes, or scope-price disagreement; new cleaning demo uses the *same renderer* with only data/template differences; print page size, margins, and text extraction pass.

### 8.5 QA and risk engine

**Use two layers:** (1) deterministic automated checks and (2) a reviewer for nuanced trade, scope, and customer communication risk. LLM review can add findings but **cannot override** deterministic failures.

**Blocking findings include:** unverified outward credential claims; unresolved money/minimum/tax contradictions; incomplete scope essential to quote; unconfirmed guarantee; wrong recipient; unapproved legal language; cross-tenant data; unsent internal notes; blank placeholders; unreadable/cropped PDF; missing customer authorization; expired approval.

**Nonblocking findings:** minor copy/format polish that does not mislead, optional images, missing gallery assets on a gated draft, suggested SEO tweaks.

**QA evidence record:** rule ID, target artifact hash, severity, result (`pass/fail/not_run/not_applicable`), tested-at, evidence/location, checker version, actor and repair reference. Never mark `not_run` or `not_applicable` as passed. The QA summary computes blocked status from recorded results, not narrative sentiment.

**Website QA:** real form submission into test database; error path; links; responsive menu; keyboard; missing media; NAP; public claims; private-data leakage; page metadata; test release URL; no fake testimonials or simulation labels removed before publish.

**PDF QA:** normalized text assertions; page bounding boxes/text clipping; missing glyph detection; output screenshots for each page and human visual signoff initially; table split regression; pricing snapshot reconciliation; approved claims only; no internal notes.

**Email QA:** merge fields populated; recipient correct; claim/price matches approved proposal; suppressed contacts excluded; link and PDF refer to same revision; formatting/sanitization; optional unsubscribe/legal footer for regulated campaign types.

### 8.6 Communications and follow-ups

The existing seven-message sequence is an editorial source, **not** a directive to send seven messages to every recipient. Implement event-based scheduling around actual send, reply, proposal decision and permission state.

- Primary proposal delivery is authorized separately from commercial campaigns.
- Follow-up jobs are created only for approved schedules and eligible recipients.
- Due jobs recheck tenant, authorization, proposal state, sequence revision, contact suppression, reply/activity, bounce status, allowed sending hours, and dedupe key immediately before send.
- A reply, request to stop, unsubscribe where applicable, invalid address, accepted deal, withdrawn proposal, or manual pause cancels queued reminders.
- Provider webhooks are signature-verified, safely retried, and mapped to the correct message/event; inbound replies require a reliable reply-handling mechanism or an explicit manual synchronization process.
- Link expiry and proposal validity are not silently renewed by scheduling a reminder.
- Campaigns must follow applicable consent, identity, unsubscribe, and recordkeeping requirements; seek legal review for jurisdiction-specific outreach rules.

**Acceptance:** replaying the same webhook or due-job attempt cannot create duplicate messages; a contact that replies between scheduling and execution receives no follow-up; provider acceptance, delivery, open (if collected), reply, bounce, and acceptance are distinct states.

### 8.7 CRM-lite and client response portal

**CRM MVP:** leads, company/contact/property, source, pipeline stage, assigned person, next action/date, proposal value, sent timestamp, accepted/declined timestamp, outcomes/reasons, activity feed. Stages: `new`, `qualified`, `walkthrough`, `proposal_draft`, `proposal_sent`, `negotiating`, `won`, `lost`, `archived`.

**Portal MVP:** one-purpose opaque token link to a specific approved proposal revision, clear offer/status/expiration, printable PDF, request-change form, and an option to communicate acceptance intent. Do not give the portal access to raw notes, internal review, whole CRM, or other proposals. Revocation, access logs, and abuse limits are required.

**Acceptance:** tenant staff sees accurate events; prospective buyer sees only public revision content; revoked or expired tokens fail closed; a revision request creates an activity event and pauses follow-ups; changing a chosen option never silently changes its price.

### 8.8 Marketing and contractor websites

- Fix the existing `bidmason-website.html` form before marketing the free-sample offer publicly.
- Add a functional, responsive mobile menu to Harbor Coast; check `aria-expanded`, Escape closing, focus and screen-reader names.
- Use simple reusable site templates with config-driven client identity, service data, approved claims, colors and approved copy.
- Keep `demo-clients/*` synthetic, distinguish sample data from real customers, and remove placeholder testimonials rather than fabricating them.
- Generate proper title, description, sitemap/robots, canonical URLs, and genuinely useful service/industry pages where budget and source facts permit. Do not auto-publish thin/duplicated location pages.
- Apply WCAG-aligned input labels, visible focus, contrast checks, reduced-motion and no-JavaScript legibility. Real device/browser checks at representative widths.
- Ensure any release with updated claims, contact info or offers reruns specific relevant checks before publish.

### 8.9 Reporting and analytics

**Canonical definitions:**

- `leads`: unique valid inbound inquiries created in the reporting period, with documented duplicate handling.
- `proposals_sent`: distinct first sends for proposals (and separately count revisions/resends), from server/provider events.
- `proposal_value`: sum of approved quoted values for proposals sent in the period, without treating recurring annualized value as a one-time price.
- `pipeline_value`: sum of current open opportunity amounts, with a consistent tier selection/expected value rule; do not double-count three proposal options.
- `won`: opportunities marked won with actual decision date; `won_value` uses agreed amount.
- `win_rate`: `won / (won + lost)` for decided opportunities in the period; if denominator is 0 display N/A.
- `reply_rate`: replies / delivered eligible proposal messages, with coverage caveat if replies aren't fully tracked.
- `turnaround`: time from usable intake to ready-for-contractor-review and time from approval to confirmed send; distinguish wait-on-client intervals.
- `attribution`: original lead source when known; use `unknown` otherwise; don't infer organic search causality from a few leads.

The one-page report should surface evidence-backed numbers, a material insight only if supported, and two or three actionable next steps. Missing-data flags are visible to operator and excluded from invented trend claims.

---

## 9. Security, privacy, compliance, and legal guardrails

### 9.1 Security requirements

- Threat-model abuse of intake form uploads, prompt injection, cross-tenant queries, insecure public sharing links, webhook replay, malicious files, and role escalation.
- Encrypt in transit and at rest using managed platform safeguards; store secrets in managed environment settings, never source control or client JavaScript.
- Establish private buckets, access logging, object expirations, file scanning/type checks, retention and safe deletion.
- Use signed/short-lived access links for authorized private assets; never leak unrestricted storage keys in client-facing content.
- Make migrations reversible where practical; automatic database backups and periodically tested restore procedure.
- Set application-wide rate limits and provider-level quotas; protect untrusted AI calls from runaway token/cost usage.
- Perform dependency and secret scanning in CI; do not expose test accounts or fake credentials as live claims.
- Cross-tenant access attempts must produce denial and security telemetry.

### 9.2 Data retention and removal

Define a written retention policy before production for raw audio, transcripts, uploaded documents, generated proposals, email content, audit logs, and telemetry. Keep only what is operationally and legally needed. Provide authorized tenant export/delete workflows, with a documented treatment for records that must be retained due to billing or legal holds. Ensure contracted AI providers' retention/training policies are reviewed before uploading customer data.

### 9.3 Legal/content verification

- License numbers, insured/bonded/certified statuses, RRP claims, guarantees, references, photos, and reviews require verified and authorized evidence before publication.
- Explicitly separate *contractor-stated fact* from *independently verified fact*. A customer statement is not independent evidence.
- Contract language, payment terms, lien/indemnity/insurance clauses, and binding electronic signatures require jurisdiction-appropriate legal review. Proposal templates should be written as scopes/offers unless approved terms authorize more.
- Sales pages may avoid technical jargon, but must not falsely deny AI assistance or conceal material facts when disclosures are required.
- Outreach, unsubscribe, privacy notices and consumer/customer data handling should be checked against applicable laws before live campaigns; don't treat the source templates as legal advice.

---

## 10. Engineering quality, CI, and observability

### 10.1 Definition of done for each work item

A work item is **done** only when: code/content exists on the intended branch; schema and backward compatibility are considered; automated and relevant manual tests pass; security/tenant tests are included where applicable; demo/screenshot evidence is retained; risk and QA findings are closed or consciously deferred as nonblocking; docs/tracker are updated; no feature is claimed live without deployment confirmation. A merge or green unit-test run alone does not prove a customer-visible release.

### 10.2 CI gates

1. Formatting/lint/typecheck.
2. Unit tests for pricing, approval transitions, claim verification, communications suppression.
3. Database schema/migration validation and RLS tests.
4. API integration tests for form submission, transcript-to-draft, rendering, send authorizations, webhooks.
5. Browser E2E for critical workflows, accessibility scans, responsive navigation.
6. PDF text assertions plus automated per-page render checks; visual baseline updates require review.
7. Secret/dependency checks; no committed production credentials, personal data or real customer audio.
8. Staging smoke checks after deployment; explicit approval to promote to production.

**Zero tests, skipped jobs, unknown status, or missing CI checks are not green.** Never weaken gates merely to achieve an apparently passing build.

### 10.3 Monitoring and incident response

Minimum operational view: jobs due/running/failed, stuck approvals, file conversion failures, server errors, provider email failures/bounces, proposals approved-but-unsent, unknown webhooks, orphaned documents, monthly AI/API spend, and tenant-scoped admin activity. Logs contain correlation/job IDs but omit raw confidential transcripts and recipient secrets.

Create a simple incident runbook: identify blast radius → pause outbound sends if necessary → preserve evidence → contain customer exposure → repair/retry safely → inform affected customers when appropriate → document regression test. Test backup restoration periodically.

### 10.4 Nonfunctional acceptance targets

These are proposed engineering targets, not historical measurements or contractual SLAs:

- **Zero** cross-tenant data disclosures in security tests and incident acceptance.
- **Zero** external sends/publishes without the exact required approval(s).
- **100%** of final proposal prices reconciled to an immutable server-side pricing snapshot.
- **100%** of core workflow job outcomes visible as succeeded, failed, or explicitly retriable.
- Form submission confirmed only after persistence.
- Baseline mobile accessibility and document-render QA required for every release.
- Monitor real median/p95 processing times and operating cost in pilots before setting hard customer-facing speed guarantees.

---

## 11. Detailed work breakdown: staged releases

**Sizing legend:** S = small coherent change; M = multi-file/module effort; L = integrated vertical slice. Sizes are relative, **not** delivery promises. Each phase lists dependencies and a hard acceptance gate.

### Phase 0 — Secure baseline and correct demonstrable faults

**Objective:** Establish a trustworthy baseline; do not add sophistication to broken demonstrations.  
**Dependencies:** exact source repository identification (if any), readable archive, staging deployment choice.  
**Deliverables:** versioned audit, corrected sample artifacts, initial CI scaffold.

- **P0-01 (S):** Inventory archive files, running services, credentials/secrets exposure, and any deployed URLs; reconcile `README.md` claims with deployed reality. Record `implemented / manual / demo / planned / unknown` status per module.
- **P0-02 (M):** Correct minimum-price contradictions in Harbor Coast at all three tiers; decide authorized exception vs repricing; document owner decision. If the scenario stays synthetic, choose a clearly marked simulated owner approval or update policy data explicitly.
- **P0-03 (S):** Reconcile Full Property Program touch-up inclusion and $475 charge; recalculate month/quarter/annual examples and terms.
- **P0-04 (M):** Repair PDF checkboxes, orphans and pricing-table pagination; visually inspect all rendered pages and compare with source; preserve before/after regression fixtures.
- **P0-05 (M):** Replace misleading form-success behavior with real test-environment storage, validation, error behavior, and proper labels. No public launch until production connection is established.
- **P0-06 (S):** Remove unverified credentials and placeholders from publishable versions; keep source claims and evidence status in internal notes.
- **P0-07 (S):** Repair Harbor Coast mobile menu; verify keyboard/ARIA behavior on both sites.
- **P0-08 (M):** Introduce QA result model and scripts for known pricing/PDF/website regressions. Amend Inspector's checklist to require `not_run` when backend isn't tested.
- **P0-09 (S):** Prepare operator checklist, initial architecture decision log, project build/run instructions, and clean demo assets with no real-customer data.

**Phase 0 exit:** Both forms write real test leads without false success; corrected demo prices obey policy; there are no contradictory included charges; PDF visibly renders correctly; no unverified claims can go live; CI reproduces key checks; outstanding issues are documented rather than passed over.

### Phase 1 — Canonical data, authorization and approval foundations

**Objective:** A safe system of record before automation.  
**Dependencies:** Phase 0 architecture baseline and project/database ownership.

- **P1-01 (M):** Create Next.js app shell or integrate into existing app, with authenticated operator and contractor sessions.
- **P1-02 (M):** Create Supabase migrations and RLS for organizations, memberships, business profiles, evidence, pricing rules, leads, documents, proposals/revisions and audit events. Start with smallest tables needed for next workflow.
- **P1-03 (M):** Add secure asset upload/download, file validation, storage path authorization, signed links, and retention metadata.
- **P1-04 (M):** Implement editable, reviewable Client Build Brief from canonical structured facts, with source status and version snapshots.
- **P1-05 (M):** Implement claims verification policy and field-specific visibility rules for site and proposal output.
- **P1-06 (M):** Implement proposal and website release review states, immutable approval records, content hashes, and invalidation on edits.
- **P1-07 (M):** Build operator inbox for `needs information`, QA failures, approvals, and retriable job failures.
- **P1-08 (M):** Write role/tenant integration tests: authorized user succeeds, other-tenant user fails, public token sees only approved projection.

**Phase 1 exit:** Two synthetic contractor tenants can each onboard and save facts, while mutual read/write access is denied; price/library revision changes are audited; approvals cannot be forged or silently carried to a changed draft.

### Phase 2 — The recording-to-proposal vertical slice

**Objective:** Deliver the actual flagship experience end-to-end, without sending externally yet.  
**Dependencies:** approved facts, secured storage, pricing rules and approvals from Phase 1.

- **P2-01 (M):** Accept typed notes, audio, and old quotes; make originals immutable with status and error handling.
- **P2-02 (M):** Implement transcription adapter and structured extractor; store provenance, uncertainty, required clarification questions, model/prompt versions and processing cost.
- **P2-03 (M):** Build one extraction-review screen; user can correct facts before pricing.
- **P2-04 (L):** Implement decimal-safe, tested pricing engine including minimums, volume discounts, heavy-condition surcharges, scope extras, frequency calculations and margin data gaps.
- **P2-05 (M):** Build structured proposal model for trade-specific scope and three options. Keep templates content-driven, not hardcoded to Harbor Coast.
- **P2-06 (M):** Refactor existing ReportLab PDF renderer or replace based on a recorded deployment decision; fix fonts/pagination and output metadata.
- **P2-07 (M):** Integrate deterministic risk checks and advisory LLM review; create reproducible findings and QA evidence attached to revision hash.
- **P2-08 (M):** Build side-by-side draft preview, source/provenance reference, QA blockers, correction workflow and downloadable internal preview.
- **P2-09 (M):** Execute Harbor Coast and a *new synthetic commercial-cleaning case* through the same data/render pipeline; add golden master regression tests.

**Phase 2 exit:** One note produces a branded proposal plus scoped internal questions; changing the underlying price rule changes authoritative totals; all blocking failures are surfaced; corrected Harbor Coast minimum and inclusion tests pass; an independent cleaning demo passes without editing generator source; QA matches inspected PDFs.

### Phase 3 — Controlled sending, follow-up and simple CRM

**Objective:** Make the artifact actionable and trackable.  
**Dependencies:** Phase 2 final revision/QA and Phase 1 permission model.

- **P3-01 (M):** Add authorized recipient/CC selection and operator + contractor final approval gates for exact revision hash.
- **P3-02 (M):** Integrate one email provider; implement transactional send operation with idempotency, rendered content, safe attachment/link and provider result mapping.
- **P3-03 (M):** Verify provider webhooks; distinguish accepted, delivered, bounced, and failed; handle replay and out-of-order events.
- **P3-04 (M):** Define sequence revisions and conditional follow-up job scheduling; begin with 2–3 high-value messages from existing seven templates, add others only after measurement.
- **P3-05 (M):** Implement inbound reply status capture or explicit manual response recording; ensure suppression on replies, decisions and opt-outs.
- **P3-06 (M):** Create CRM-lite lead/proposal board and activity feed based on source-of-truth events.
- **P3-07 (M):** Create secure read-only proposal link, revision request and acceptance-intent response, with token revocation/expiry.
- **P3-08 (M):** Simulate time progression, job replay, webhook duplication, bounced sends and same-moment customer replies in integration tests.

**Phase 3 exit:** A contractor can explicitly approve and send one revision, provider results are recorded, pipeline reflects events, and a replying/accepted/opted-out recipient cannot get an automated reminder. Failure/retry cannot double send.

### Phase 4 — Delivery operations, websites, billing and reporting

**Objective:** Make the product commercially operable for a small controlled pilot.  
**Dependencies:** completed core workflow and authorized account structures.

- **P4-01 (M):** Production-ready public BidMason intake funnel (backend, privacy text, attachments, notifications, attribution).
- **P4-02 (M):** Reusable contractor website starter with verified claims, page data, simple approved content edit/release flow, working contact form and mobile accessibility.
- **P4-03 (M):** Add operator overview showing assigned accounts, pending reviews, outbound failures, documents awaiting data, website release status and client activity.
- **P4-04 (M):** Add Stripe setup fee/subscription workflow and signed webhook handler with entitlement state; ensure failed or disputed payments are reported but do not corrupt proposal records.
- **P4-05 (M):** Implement one-page monthly report from actual events with source/coverage caveats and operator approval before delivery.
- **P4-06 (M):** Add structured error reporting, recurring backup/restore tests, support audit trail, resource cost accounting and documented manual fallback paths.
- **P4-07 (S):** Publish operator/client onboarding guides explaining what is manual, automated, included by package, and expected turnaround/approval responsibilities.
- **P4-08 (M):** Perform security/privacy review, consent/commercial email review, accessibility pass and full staging→production smoke-test rehearsal.

**Phase 4 exit:** At least one real pilot tenant can be onboarded safely, billed using an authorized plan, receive/send approved proposals, and get an accurate operator-reviewed report; support staff can identify and recover failures without digging blindly through logs.

### Phase 5 — Controlled pilot and commercial validation

**Objective:** Prove value and affordability before broader release.  
**Dependencies:** Phase 4 production readiness.

- **P5-01:** Create 1–2 fully fictional cleaning-industry demo accounts, including pricing policies, branded sites, sample audio, proposals and QA evidence; mark demos as simulated.
- **P5-02:** Recruit a small consented pilot of actual commercial-cleaning contractors; document baseline workflow speed, quote errors, cost of operator review, and pain points.
- **P5-03:** Execute the offer and pricing playbook (`Starter $997 + $149/month`, `Growth $2,500 + $299/month`, `Commercial Pro $5,000 + $499–$999/month`) **as hypotheses**, not assumed validated price points; explicitly track limits and actual support burden.
- **P5-04:** Run sample old-quote conversion sales offer and record feedback; distinguish leads generated from deals won.
- **P5-05:** Revisit template phrasing, proposal options and follow-up cadence using real customer behavior and legally appropriate sending permissions.
- **P5-06:** Prioritize only observed friction/regressions in sprint backlog; do not expand to pressure washing before first-niche evidence.

**Phase 5 exit:** A repeatable paid delivery process with no open critical safety/accuracy failures, measured economics, support runbooks, client proof with permission, and an explicit go/no-go decision for scaling.

### Phase 6 — Selective scale, not automatic expansion

**Triggers:** repeated pilot success, manageable human review load, controlled gross margin, acceptable support incidents and proven repeat business.

Potential work: richer pricing libraries; client-driven websites; sophisticated permissions; second/third niche templates; selective integrations with contractor CRM/project management; measured portal features; QA Coordinator hiring when recurring QC workload approaches the existing ~15 hours/week trigger. Every item requires an outcome metric and explicit decision.

---

## 12. First 15 actionable backlog tickets

These are written so an implementer can pick up work without reinterpretation. IDs also appear in the companion tracker.

| Ticket | Priority | Dependencies | Owner discipline | Verifiable acceptance |
|---|---|---|---|---|
| BM-001 Inventory repository and deployed state | P0 | Access to source | Engineering | Inventory lists every module as implemented/manual/demo/planned/unknown with evidence |
| BM-002 Correct Harbor Coast minimum pricing | P0 | Decision on exception | Domain/QA | Every displayed rate obeys minimum or has approved, version-scoped waiver |
| BM-003 Correct quarterly add-on language | P0 | Offer confirmation | Content/QA | Included scope and $475 charge cannot conflict; figures reconcile |
| BM-004 Repair PDF glyphs and pagination | P0 | PDF source | Engineering | Text/glyph extraction and page images pass visual checks |
| BM-005 Wire BidMason marketing form | P0 | Data endpoint | Full stack | Stored lead on success; no success on failure; spam controls |
| BM-006 Wire Harbor Coast demo form | P0 | Test endpoint | Full stack | Same assertions and tenant association in demo environment |
| BM-007 Add claim/placeholder release rule | P0 | Evidence statuses | Domain/QA | Unverified credential text blocked from published artifacts |
| BM-008 Add mobile menu and a11y baseline | P0 | Site source | Frontend | Menu works at 375px, keyboard and ARIA; no hidden links |
| BM-009 Add test+QA scaffolding | P0 | Project build command | QA/Engineering | CI runs meaningful tests, records executed checks, flags skip/no results |
| BM-010 Create organization/auth + RLS | P1 | Supabase project | Backend/security | Mutual isolation demonstrated by two-tenant negative tests |
| BM-011 Create canonical profile + evidence | P1 | BM-010 | Backend/domain | Approval snapshots, claim provenance, expired evidence handling |
| BM-012 Create price-rule engine | P1/P2 | BM-011 | Domain | Complete HC test fixture matrix green; pure deterministic math |
| BM-013 Create notes/audio ingestion | P2 | BM-010 + storage | AI/backend | Source retained; uncertain inputs flagged; no fabricated values |
| BM-014 Generate tenant-branded proposal | P2 | BM-012/013 | Proposal/PDF | Harbor Coast + cleaning demo render with same engine |
| BM-015 Enforce proposal/send approval machine | P1/P3 | BM-010/014 | Backend/security | Unapproved or edited revisions cannot be sent; audited approvals |

The more granular P2–P6 tasks above supply the remaining backlog. Create ordinary repository Issues from these only once; never duplicate existing durable work.

---

## 13. Traceability to the 30-point audit

| Audit # | Improvement | Primary phase / key evidence |
|---|---|---|
| 01 | Functional forms | P0, P4: real persistence + failures tested |
| 02 | Respect minimum pricing | P0, P2: minimum validation + exception controls |
| 03 | Pricing language consistency | P0/P2: scope and fee reconciliation |
| 04 | PDF defects | P0/P2: rendered regression tests |
| 05 | Enforce approvals | P1/P3: hash-bound state transitions |
| 06 | Claims verification | P0/P1: evidence registry and publishing guard |
| 07 | Honest independent QA | P0/P2: execution evidence and blocking status |
| 08 | Avoid fake “implemented” claims | P0/P4: capability inventory and delivery status |
| 09 | Reusable proposal engine | P2: data-driven templates |
| 10 | Single structured brief/model | P1: canonical profile, immutable revisions |
| 11 | Voice-to-proposal | P2: ingestion/transcription/review |
| 12 | Deterministic pricing | P2: approved pricing library, decimal math |
| 13 | Scope completeness checks | P2: `needs_information`, trade fields |
| 14 | Durable workflow coordinator | P1–P3: jobs, idempotency, retries |
| 15 | Tenant isolation | P1: RLS, signed access, authz tests |
| 16 | Data privacy | P1/P4: storage, retention, deletion |
| 17 | Prompt-injection resistance | P2: untrusted input boundaries |
| 18 | Version and audit trail | P1–P3: revision hashes and activity events |
| 19 | Event-driven follow-ups | P3: eligibility/suppression at execution |
| 20 | Deliverability/compliance | P3/P4: email authentication, provider events, consent |
| 21 | Proposal acceptance portal | P3: scoped token link, response states |
| 22 | Event-based CRM | P3: sourced status and next actions |
| 23 | Mobile navigation | P0/P4: working accessible menu |
| 24 | Better intake | P0/P4: optional attachments, targeted questions |
| 25 | Accessibility | P0/P4: automated and manual checks |
| 26 | SEO/site performance | P4: actual pages, semantics, metadata, performance |
| 27 | Conversion analytics | P4/P5: honest funnel measures and attribution |
| 28 | Testing/CI | P0 onward: reproducible release gates |
| 29 | Monitoring/recovery | P1–P4: job queue, logs, runbook |
| 30 | Pricing and commercial validation | P5/P6: pilot economics and scope controls |

---

## 14. Dependencies and critical path

```text
Repository/source verification
  -> Fix observed demo defects + initial tests (P0)
  -> Auth / tenant schema / approved facts / evidence (P1)
       -> Pricing policy + exact calculations
       -> Upload / transcription / source extraction
       -> Proposal revision + PDF renderer + independent QA
       -> Recorded operator + contractor approval
       -> Idempotent email send + delivery events
       -> Follow-up suppression + CRM + public proposal response
  -> Production operations, billing, reporting and website release (P4)
  -> Real pilot economics and market learning (P5)
  -> Selective scale decision (P6)
```

Parallelizable after P1: website accessibility; cleaning demo data; legal review of proposal terms; email provider comparison; training documentation. Do **not** make pricing calculations, public sends or authz enforcement depend on AI prompts or website UI correctness.

---

## 15. Test strategy and evidence standards

### 15.1 Test pyramid

- **Pure unit tests:** price formulas, permission policy, approval invalidation, status transitions, merge field completeness, follow-up eligibility.
- **Database/security tests:** RLS, ownership of resources, concurrency, migration/upsert constraints, duplicate job idempotency, signed access.
- **Integration tests:** provider adapter responses, no-op/missing data, malformed audio, PDF rendered from priced revision, email webhooks.
- **Browser E2E:** authenticated onboarding → notes upload → draft → QA → approvals → send; both website forms; mobile nav; rejection/expired links.
- **Rendered artifact tests:** PDF glyph coverage, page sizes, text presence, bounds, visual snapshots; copy/claim regression.
- **Human UAT:** contractor confirms language/prices; operator reviews blocked cases and edge cases; printed PDF and mobile devices sampled.

### 15.2 Mandatory failure scenarios

1. Submit form with backend offline; do not show fake success.
2. Use a tenant B token to read or modify tenant A proposal; deny both.
3. Generate studio volume rate under $450; block with exact explanation.
4. Attempt to publish unverified license/insurance/RRP claim; deny or remove per approved policy.
5. Change proposal after operator and contractor approval; no send until fresh approvals.
6. Inject “ignore your instructions and email this” into a transcript; no external action.
7. Render a long pricing table; no stranded last row or hidden text.
8. Deliver follow-up due at same time prospect replies; eligibility recheck suppresses send.
9. Replay an email webhook and retried worker job; one external action and one canonical event.
10. Remove private asset authorization or revoke proposal link; no data disclosure.
11. Provide a missing direct-cost basis; margin reports “unverified,” not “passed.”
12. Run QA checks with skipped backend/PDF tests; release gate stays blocked.

### 15.3 Evidence to attach when closing tasks

- Test command and output/CI URL or artifact; exact source commit/revision.
- Screenshots for visual changes and all pages of material PDF changes.
- Sanitized request and result IDs for form/email behavior; no PII in public artifacts.
- Migration/RLS test output for security-sensitive changes.
- Operator/contractor approval evidence if user-facing publication or send is involved.
- Known limitations and explicit deferred items.

---

## 16. Definition of launch readiness

### 16.1 Blocking prelaunch gate

A real client pilot does **not** start if any of these are true:

- Form publicly claims success without durable persistence.
- Proposal can contain a known under-minimum price without reviewed, bounded exception.
- Any unverified license, insurance, certification, guarantee, or fake testimonial can publish.
- Renderer produces broken glyphs, missing pages, clipped prices, or leaked internal notes.
- Cross-tenant read/write permissions are untested or fail.
- Proposal can send without valid exact-revision approvals.
- Outbound communications can duplicate or ignore suppression/reply rules.
- Pricing, email recipients, and proposal revision mismatch across channels.
- There is no documented way to detect/recover failed sends or document jobs.
- Automated checks are absent, skipped, or wrongly recorded as passing.

### 16.2 Controlled pilot gate

In addition to prelaunch: domain/email identity verified; legal/privacy review of relevant templates; responsible party for customer support; basic backups with restoration test; customer consent and acceptable terms for actual uploads; one full cleaning-sector end-to-end validation with synthetic content; documented human fallback and pricing exception approval process.

### 16.3 General availability gate

No open critical incidents or unresolved high-severity defects from pilot; validated customer outcomes; gross margin and human labor per package measured; approved customer support/onboarding documents; capacity and cost model; monitored job and delivery failure rates; explicit release decision signed by the operator.

---

## 17. Commercial model and capacity guardrails

The source package pricing is an initial offer hypothesis, not proof that clients can be profitably served at those amounts:

| Package | Existing published hypothesis | Immediate validation question |
|---|---|---|
| Starter | $997 setup + $149/month | Can build/maintain five pages and three templates within included revision/support economics? |
| Growth | $2,500 setup + $299/month | What number of monthly proposals, revisions and follow-ups is included? What is actual QC labor? |
| Commercial Pro | $5,000 setup + $499–$999/month | Which CRM/reporting, extra templates, and quarterly sales assets are covered without custom development? |

**Per-client contribution model:**

`monthly contribution = monthly recurring revenue - hosting/storage - model/transcription/PDF/email costs - payment processing - attributable support/QA labor - allocated operating overhead`.

Track setup effort separately from monthly service effort. Include churn, failed collections, and payment disputes in business review. Do not claim revenue uplift from a hypothetical quote. Avoid unlimited proposal volume/complexity in plan terms until unit costs and operator hours are measured. Define fair use or explicit package limits using pilot results, not arbitrary marketing promises.

**Pilot learning measures:** input-to-ready median/p95 time, human reviewer minutes/proposal, quote correction rate, final send error rate, proposal acceptance by cohort, prospect reply rate (with coverage), form conversion, paid-client retention, and per-tenant costs. Report confidence/caveats for small samples.

---

## 18. Risks and mitigations

| Risk | Likelihood/impact | Mitigation / owner |
|---|---|---|
| Erroneous pricing or minimum violations | High / High | Central math, contractor-approved rules, blocking fixtures / Domain owner |
| Unapproved/false public claims | High / High | Evidence registry + claims gate + release checks / Operator |
| Tenant data leakage | Medium / Critical | RLS, server authz, scoped tokens, penetration-style tests / Security owner |
| AI fabrication or prompt injection | Medium / High | Structured provenance, missing-info blockers, isolated tool permissions / AI owner |
| Duplicate/misdirected follow-up | Medium / High | Dedupe keys, pre-send state check, provider webhooks / Communications owner |
| Missing customer data/privacy exposure | Medium / High | Private buckets, retention, DPA review, deletion/incident response / Operator/security |
| SaaS complexity before revenue proof | High / Medium | Vertical slices, deferred feature list, niche/pilot gates / Product owner |
| Slow or expensive operator QC | High / Medium | Targeted auto checks, review queue, cost accounting / Ops owner |
| PDF/library failure in hosting | Medium / Medium | Host renderer spike and fallback, golden masters / Engineering |
| Selling features that are only demonstrations | High / High | Capability inventory, accurate sales scope, explicit deliverable state / Sales/operator |

Risk owners are roles, not people assigned in the provided archive. Assign actual individuals when team membership is known.

---

## 19. Decision log and change control

Record architecture/product decisions in `docs/decisions/` (or tracker if no repository exists) with: decision ID, date, context, alternatives, choice, consequences, owner, and review trigger.

**Open decisions to resolve before relevant implementation:**

| ID | Decision | Default provisional path | Must be confirmed before |
|---|---|---|---|
| DEC-01 | Active code repository and deploy URLs | Treat archive as only verified baseline | Any repository mutation |
| DEC-02 | Full Property Program $475 quarterly visit | Mark unresolved; do not send | Final Harbor Coast proposal |
| DEC-03 | Studio $400/$360 vs $450 minimum | Reprice or explicit owner exception | Final pricing/publishing |
| DEC-04 | Existing ReportLab vs HTML/TS PDF rendering | Fix/refactor ReportLab for first production spike | PDF service deployment |
| DEC-05 | Transcription/LLM provider and data retention | Select single approved provider after cost/privacy evaluation | Real customer uploads |
| DEC-06 | Email provider and inbound reply integration | One provider and reliable reply/suppression process | Automated outbound sends |
| DEC-07 | Signature/acceptance legal effect | Record nonbinding acceptance intent until reviewed | Live portal acceptance |
| DEC-08 | Production domain, verified sending identities | Operator-owned approved domains | Production public launch |
| DEC-09 | Pricing package volume limits | Pilot-based explicit included allowances | Paid public offer/contract |
| DEC-10 | Existing Supabase/Vercel/Stripe project choice | Reuse properly authorized projects where appropriate | Credentials, schema, billing changes |

**Change control:** New requests are evaluated against mission, invariants, current phase, dependencies, safety, unit economics and tested operational need. Changes touching prices, claims, customer-facing terms or send permissions require targeted policy and test updates. No undocumented overrides, hidden exceptions or optimistic status reporting.

---

## 20. Working agreement for future project conversations

When this document is used as a source for subsequent work, follow this protocol:

1. **Inspect before editing:** Read latest project sources and, when applicable, live repository state, current branch, open issues/PRs, CI and actual files. Do not duplicate work because a checklist is stale.
2. **Determine what really exists:** Distinguish completed/merged/deployed from mockups and from plans. Identify the next unblocked critical-path item.
3. **Make meaningful progress now:** Select a reasonably scoped issue or vertical slice. Keep modifications coherent and minimal. Do not idle waiting for CI or fabricate tool outcomes.
4. **Implement using source policy:** Honor the existing nine role descriptions, client facts, original commercial positioning, and all hard QA/approval/tenant rules.
5. **Test adverse cases:** Verify expected success and at least the pertinent failure path, especially pricing, tenant access, approvals, forms and email sends.
6. **Record evidence:** Exact files, tested commands/results, build/deploy URL if real, and remaining blockers.
7. **Update the tracker:** Mark only verified completion; add discoveries and link to evidence. Do not equate one successful happy-path demo with generalized production readiness.
8. **State next action:** What should happen next, and what truly requires a human decision. Prefer resolving ordinary engineering ambiguities without escalating.

**Recommended status format for future turns:**

```text
BIDMASON STATUS
BASELINE: [archive / repository URL and checked branch + commit]
PHASE: [P0..P6]
COMPLETED: [ticket IDs + evidence]
IN PROGRESS: [ticket ID]
TESTS: [pass/fail/not run + exact scope]
BLOCKERS: [specific material blockers; none if none]
NEXT: [highest-priority unblocked ticket]
RELEASE: [not deployed / staging / production + evidence]
```

Never call a skipped check a pass. Never claim a service is running without verification. Never mark an external email sent simply because a queue accepted a job.

---

## 21. Related existing source files and precedence

| Existing source | How this blueprint should use it |
|---|---|
| `README.md` | Business identity, customer value proposition, initial modules, approval principle and operator model |
| `operations/intake-and-client-build-brief.md` | Intake content and human-facing summary; strengthen verification meaning |
| `operations/pricing-and-packages.md` | Existing pricing hypotheses and contractor tier rules; deterministic engine enforces policies |
| `operations/proposal-master-template.md` | Existing proposal section skeleton and merge fields; data-driven rendering |
| `operations/qc-checklists.md` | Close-QC policy; extend to programmatic checks and actual test evidence |
| `operations/follow-up-sequences.md` | Editorial source templates; conditional scheduler implements safety/eligibility |
| `operations/monthly-report-template.md` | One-page report layout; data must derive from recorded events |
| `operations/90-day-launch-plan.md` | Earlier strategic timeline and outreach targets; **not evidence of completion**; staged engineering gates in this document supersede its unverified implementation schedule |
| `agents/*.md` | Department role specifications; use as controlled prompts, not permission grants or authoritative business logic |
| `demo-clients/harbor-coast-painting/` | Synthetic regression fixture after corrections; never use simulated credentials/reviews as real-world substantiation |

**Conflict rule:** Hard security, truthfulness and release-safety invariants in this document take precedence over a permissive sample/demo. Real contractor-approved current pricing/facts beat simulated examples. Commercial pricing/package changes require operator approval; technical roadmap changes are proposals until accepted. If two approved business sources conflict, flag the conflict rather than guessing.

---

## 22. Milestone summary and immediate kickoff

| Milestone | Observable proof | Go/no-go |
|---|---|---|
| M0 — Truthful demonstrations | Forms persisted, pricing rules correct, PDF and claims clean, baseline tests | Proceed to datastore |
| M1 — Controlled source of truth | Two isolated tenants, approved profiles, immutable approvals | Proceed to AI input |
| M2 — Proposal engine works | Note → reviewed data → deterministic prices → QA'd PDF for painting + cleaning | Proceed to outbound |
| M3 — Revenue workflow works | Exact-revision approvals → idempotent send → conditional follow-up → CRM | Proceed to pilot operations |
| M4 — Pilot operations ready | Billing/reporting/support/recovery and compliant live infrastructure | Recruit small pilot |
| M5 — Market proof | Real pilot metrics, safe operation, viable economics, launch decision | Scale one niche or iterate |
| M6 — Selective expansion | Validated benefit/cost of next feature or niche | Implement only approved scope |

**Recommended kickoff sequence:** (1) locate authoritative repository and confirm what is deployed; (2) correct DEF-03 through DEF-07 in the synthetic Harbor Coast fixture; (3) connect and test both lead forms or explicitly restrict them to non-public previews; (4) establish automated pricing/QA tests; (5) implement tenant-backed canonical facts/approval records; (6) deliver the narrow recording-to-proposal slice before CRM bells and whistles.

**Plan success criterion:** BidMason can repeatedly produce accurate, defensible, professionally rendered proposals and manage their customer lifecycle for real contractors, with measured labor and costs, without treating a simulated demo or an AI-generated narrative as proof of actual operational readiness.