# BidMason — GitHub delivery master plan
Version 1.0 · 2026-10-14 · source of truth: `mlookhere/Bidmason`

## Baseline and governing documents
The GitHub repository was empty at inspection. Source material: user-provided `bidmason.zip`, `BIDMASON_MASTER_IMPLEMENTATION_PLAN.md`, `BIDMASON_EXECUTION_TRACKER.md`; CI references `mlookhere/CI-Pipline` (dev @ `d6ce65c`) and the GPT-friendly CI archive. Nine agent files in the source are **operating prompts**, not deployed services. Demo assets must remain synthetic and clearly labeled. No existing deployment, backend, payment integration, or live sending is verified.

**Invariant:** All pricing calculations deterministic and decimal-safe; tenant RLS enforced; public claims evidence-verified; source inputs untrusted; final send/publish requires exact-revision approvals; retries idempotent; missing/pending/skipped checks block promotion. Never fabricate completion.

## Numbered, independently deliverable slices

### 1. Source import + scaffold/toolchain + real CI gates
**Acceptance:** Import cleaned original business source without credentials; establish `main` and `dev`; port only runtime-neutral GitHub CI utilities from template, replace Claude requirements with ChatGPT-friendly policies, create working `./scripts/bootstrap --ci` and `./ci/run fast|pr|security`, run tests headlessly; fast and PR Actions complete successfully. No empty or skipped checks accepted.
**Areas:** root source, `.github/workflows`, `ci/`, `scripts/`, `docs/`, `.chatfreept/`.
**Gates:** fast, PR, security, secret scan. **Risk:** `risk:ci`, `risk:supply-chain`.

### 2. Correct existing public/demo artifacts and enforce truthful QA
**Acceptance:** Harbor Coast $450 minimum respects discount order; quarterly $475 included/additional contradiction resolved by owner-approved fixture policy; PDF glyphs/pagination pass page-by-page checks; remove unverified claims and testimonials from publishable output; mobile navigation works at 375px; both forms have real persistence or remain disabled/nonpublic until backing endpoint is verified.
**Areas:** `demo-clients/`, marketing site, proposal renderer, regression tests.
**Gates:** pricing, PDF QA, a11y/E2E, form failure tests. **Risk:** `risk:pricing`, `risk:claims`, `risk:public-data`.

### 3. Tenant-safe canonical data and approvals
**Acceptance:** Operator/contractor authentication, organizations, memberships, structured approved business facts and evidence, Supabase RLS/storage, immutable revisions and approval invalidation, negative two-tenant authorization tests.
**Areas:** app, migrations, auth, storage, domain.
**Gates:** migration/RLS, unit/integration, security. **Risk:** `risk:tenant`, `risk:security`.

### 4. Intake, transcription, extraction and deterministic pricing
**Acceptance:** Typed notes and protected uploads; retained originals; transcription failure safety; structured extraction with provenance and human review; accurate discount/minimum/surcharge/tax/margin rules; all supplied Harbor Coast cases plus cleaning case pass.
**Areas:** ingestion, AI adapter, pricing domain, review UI.
**Gates:** unit pricing, adversarial extraction, integration, security. **Risk:** `risk:pricing`, `risk:privacy`, `risk:ai`.

### 5. Reusable branded proposal and evidence-backed QA
**Acceptance:** One structured renderer for painting and commercial cleaning, no internal notes or unverified credentials, legible PDF and bounds tests; blockers and `not_run` recorded truthfully; hash-bound operator and contractor approvals; revisions invalidate signoff.
**Areas:** proposals, PDF, QA, review UI.
**Gates:** PDF full render, approval unit/integration, visual/e2e. **Risk:** `risk:claims`, `risk:approval`.

### 6. Controlled delivery, follow-up, portal and CRM-lite
**Acceptance:** One email provider, signed deduplicated webhooks, exact-recipient send guard, idempotency, separated delivery state, reply/opt-out/bounce suppression, tokenized read-only proposal view and buyer response, event-backed CRM.
**Areas:** communications, jobs, portal, pipeline.
**Gates:** send/replay/race tests, webhook validation, tenant tests. **Risk:** `risk:outbound`, `risk:privacy`.

### 7. Commercial operations: websites, Stripe, reports, recovery
**Acceptance:** Real persisted lead forms, approved site releases, Stripe webhook/entitlement controls, event-backed monthly reporting, operator review queue, observable jobs, backup/restore runbook, support and onboarding docs.
**Areas:** marketing, sites, billing, reporting, ops.
**Gates:** API/E2E, signed webhook, resilience/security, accessibility. **Risk:** `risk:billing`, `risk:operations`.

### 8. Full staging rehearsal, pilot validation and release
**Acceptance:** Synthetic cleaning tenant runs entire end-to-end workflow; tests and visual artifacts retained; security/privacy/legal reviews and consent; demonstrated failure recovery; measured pilot accuracy, turnaround and unit economics; all required Actions pass; written go/no-go decision; `main` promoted only via PR.
**Areas:** tests, runbooks, launch, release, docs.
**Gates:** fast, PR, security, staging smoke, production approval. **Risk:** `risk:release`, `risk:security`.

## Workflow
One slice = one Issue, one `work/<issue>-<slug>` branch from `dev`, one PR to `dev`. Merge only with completed successful **nonzero** relevant Actions checks. No direct commits on `dev` or `main` after initial seed. Track commits, PRs, test evidence, remaining gaps and deployments in the control Issue and execution tracker. Phases 0–6 and all BM-001..BM-055 coverage remain specified in the companion blueprint/tracker; these eight slices group—not delete—that scope.

## Critical dependencies and decisions
Start at slice 1. Before real customer data/sends: choose authorized Supabase/auth project, email provider and domain, AI retention policy, legal proposal language, contractor pricing exceptions, and ambiguous quarterly touch-up inclusion. Fail closed until owners approve. Packaging a synthetic demo is not a deployed SaaS.
