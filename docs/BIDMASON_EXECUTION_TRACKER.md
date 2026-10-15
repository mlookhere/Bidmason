# BidMason — Execution Tracker and Release Gates

**Document ID:** BM-TRACK-001  
**Version:** 1.0  
**Date:** 2026-10-14  
**Status:** Proposed / all items unverified until inspected against durable repository and deployment state  
**Companion source:** `BIDMASON_MASTER_IMPLEMENTATION_PLAN.md` (authoritative scope, architecture, checks, and priorities)

> **Tracker truth rule:** An unchecked item means **not yet verified**, NOT necessarily unimplemented. On the first implementation session, inspect the live repository and mark genuinely completed items only with matching code, tests, and deployment evidence. Do not recreate existing work. Do not infer proof from mockups, prompts or prior narratives.

## 1. Baseline record — fill this out first

| Field | Current value |
|---|---|
| Verified source | Uploaded `bidmason.zip` (June 2026 artifact snapshot) |
| Active GitHub repository | **Unknown — discover, do not assume** |
| Active default/development branches | Unknown |
| Latest inspected commit | Unknown |
| Public marketing site URL | Unknown / not independently verified |
| Auth/database project | Unknown |
| Production email/provider | Unknown |
| Live Stripe billing | Unknown |
| Working transcription/proposal pipeline | Not present in supplied archive; live state unknown |
| Current implementation phase | Phase 0 verification and correction |
| Last verified release | None confirmed from uploaded archive |
| Responsible operator/approver | To be assigned |
| Next recommended ticket | **BM-001** |

**Before changing any live system:** resolve repository, infrastructure ownership and current state. Never create a replacement project simply because the archive omits a URL.

## 2. Priority and status conventions

- **P0 critical:** blocks a truthful, safe demo or release.
- **P1 high:** required for a reliable first customer workflow.
- **P2 medium:** required before scalable operations or specific pilot features.
- **P3 optional:** evidence-triggered optimization after validation.
- **Unchecked `[ ]`:** not verified complete; inspect actual state.
- **Checked `[x]`:** evidence-backed complete; record PR/commit, test results and environment below.
- **Blocked:** leave unchecked, annotate exact blocker; never pass a gate by skipping it.
- **Partial:** leave unchecked and note the remaining acceptance requirement.

**Current counts:** 0 items verified in this tracker as of its creation; this is not a claim that the real repository is empty.

---

## 3. Phase 0 — Fix the existing proof and establish the truth

- [ ] **BM-001 — Inventory durable repository and deployments (P0).** Identify source of truth, branch/commit, CI, hosting, APIs, auth, billing, and which advertised modules actually run. **Acceptance:** evidence-linked inventory, capabilities marked implemented/manual/demo/planned/unknown. **Evidence:** _pending_.
- [ ] **BM-002 — Resolve Harbor Coast minimum pricing (P0).** Apply $450 minimum after discounts or capture a specific owner-approved exception. Check all proposal options, website pricing, emails and PDF. **Acceptance:** studio $400/$360 never silently pass; every version reconciles. **Evidence:** _pending_.
- [ ] **BM-003 — Resolve quarterly touch-up contradiction (P0).** Explicitly identify whether the $475 quarterly service is included or additional, and calculate accordingly. **Acceptance:** scope, line items and recurring totals use one meaning. **Evidence:** _pending_.
- [ ] **BM-004 — Fix PDF visual output (P0).** Replace unsupported checkbox glyphs and correct isolated pricing rows/orphans. **Acceptance:** all pages visually checked; text extraction and layout tests pass. **Evidence:** _pending_.
- [ ] **BM-005 — Make BidMason marketing form functional (P0).** Persist server-side lead with validated contact info and meaningful server-error state; add anti-spam. **Acceptance:** real test submission stored; simulated failure never produces success. **Evidence:** _pending_.
- [ ] **BM-006 — Make Harbor Coast website form functional (P0).** Reuse intake API behavior, with demo tenant routing. **Acceptance:** tenant-scoped submission and notification confirmed; failure behavior verified. **Evidence:** _pending_.
- [ ] **BM-007 — Block unverified claims and placeholders (P0).** No license/insurance/RRP or fabricated testimonial on publishable output without evidence. **Acceptance:** automated blocker triggers; demo/source remains visibly synthetic. **Evidence:** _pending_.
- [ ] **BM-008 — Repair responsive demo navigation/accessibility (P0).** Mobile menu, keyboard handling, aria-expanded, focus and sensible contrast. **Acceptance:** responsive mobile E2E/manual check; all nav destinations reachable. **Evidence:** _pending_.
- [ ] **BM-009 — Create CI and honest QA evidence (P0).** Include pricing fixtures, PDF render checks, website form success/failure and no-false-pass rule. **Acceptance:** skipped/absent checks block; executed checks have logs. **Evidence:** _pending_.
- [ ] **BM-016 — Record initial product architecture and release policy (P0).** Note what is planned and current, choose minimal integration path, and review launch blocker list. **Acceptance:** decisions and baseline risk register saved. **Evidence:** _pending_.

**Phase 0 release gate:**

- [ ] Both existing forms have real persistence and error handling in test environment.
- [ ] Harbor Coast rates comply with approved policy or bounded exceptions.
- [ ] Common-area charge language and totals reconcile.
- [ ] PDF characters, page breaks and tables are visually correct.
- [ ] No unverified credentials or fake reviews can publish.
- [ ] Actual tests—not narrative assertions—cover each above item.

---

## 4. Phase 1 — Safe, canonical data and review controls

- [ ] **BM-010 — Organization membership and tenant RLS (P0).** Auth, organizations, memberships, support roles and DB policies; two-tenant isolation tests. **Evidence:** _pending_.
- [ ] **BM-011 — Approved client facts and evidence registry (P1).** Structured business profile, `client_stated/verified/expired` claim statuses, evidence permissions, versions and signed approvals. **Evidence:** _pending_.
- [ ] **BM-015a — Proposal approval state machine (P0).** Immutable revision hash, operator and contractor signoff, invalidation after material changes. **Evidence:** _pending_.
- [ ] **BM-017 — Private document storage and controls (P0).** File validation, signed access, upload limits, tenant checks, retention metadata and audit logs. **Evidence:** _pending_.
- [ ] **BM-018 — Tenant-scoped leads/proposals/events schema (P1).** Versioned migrations, constraints, indexes and append-only activity records. **Evidence:** _pending_.
- [ ] **BM-019 — Editable Client Build Brief workflow (P1).** Intake data becomes operator-approved canonical facts; missing fields remain outstanding. **Evidence:** _pending_.
- [ ] **BM-020 — Operator review/information queue (P1).** Approvals, QA blockers, retriable jobs, evidence status and responsibility. **Evidence:** _pending_.
- [ ] **BM-021 — Authorization/security integration tests (P0).** Tenant A/B read and write denial, public link access limitation, service-role boundary checks. **Evidence:** _pending_.

**Phase 1 gate:**

- [ ] Two test tenants cannot read or modify one another's records/files.
- [ ] Source evidence and profile/pricing versions are recorded.
- [ ] No edited artifact retains its earlier signoff.
- [ ] Operator can locate every blocked/retriable item.

---

## 5. Phase 2 — End-to-end recording-to-proposal engine

- [ ] **BM-012 — Deterministic pricing library and engine (P0).** Decimal-safe, minimums, discounts, surcharges, frequency, margin and tax status; all Harbor Coast regression fixtures. **Evidence:** _pending_.
- [ ] **BM-013 — Note/audio/quote intake and transcription (P1).** Original source retained; model exceptions handled; private access and processing records. **Evidence:** _pending_.
- [ ] **BM-014 — Data-driven branded PDF generator (P1).** Same renderer works on painting and cleaning accounts; all amounts from immutable pricing snapshot. **Evidence:** _pending_.
- [ ] **BM-022 — Structured extraction with provenance (P1).** Distinguish observed versus assumed facts; source segments and uncertainty; schema validation. **Evidence:** _pending_.
- [ ] **BM-023 — Missing-data review UI (P1).** Allow human correction; unresolved material unknowns block final quote. **Evidence:** _pending_.
- [ ] **BM-024 — Risk/policy engine and blocker evidence (P0).** Deterministic issues, nuanced review, exact locations; `not_run` distinct from `pass`. **Evidence:** _pending_.
- [ ] **BM-025 — Proposal version preview and correction (P1).** Approval against exact revised content and regenerated PDF; internal notes never exported. **Evidence:** _pending_.
- [ ] **BM-026 — Harbor Coast regression scenario (P0).** Minimums, 10% discount, +40% heavy surcharge, quarterly charge, claims and PDF checked. **Evidence:** _pending_.
- [ ] **BM-027 — Commercial-cleaning regression scenario (P1).** Different trade and business profile produce a valid proposal with same system. **Evidence:** _pending_.
- [ ] **BM-028 — Prompt-injection and incomplete-source adversarial tests (P0).** Notes cannot override approval, pricing or emailing policy. **Evidence:** _pending_.

**Phase 2 gate:**

- [ ] Notes/transcript -> human reviewed extraction -> validated pricing -> branded PDF, without source-code edits for new client.
- [ ] Harbor Coast and a distinct cleaning demo pass actual pricing/PDF QA.
- [ ] Pricing can be traced to source rule, rate, quantity and exception (if any).
- [ ] Missing facts and prompt injection cannot create a final approved quote.

---

## 6. Phase 3 — Controlled sends, reply safety and CRM

- [ ] **BM-015b — Enforce send approval server-side (P0).** Exact operator-approved plus contractor-approved revision and recipient required. **Evidence:** _pending_.
- [ ] **BM-029 — Transactional email service (P1).** One provider, idempotency key, right recipient, approved PDF/link, API error handling. **Evidence:** _pending_.
- [ ] **BM-030 — Verified delivery/reply event handling (P1).** Webhook signature, dedupe and out-of-order handling, `sent` vs `delivered` vs `bounced`. **Evidence:** _pending_.
- [ ] **BM-031 — Conditional follow-up scheduler (P0).** Scheduled approved templates, recheck before send, suppress after reply, stop, bounce, won/lost and revision changes. **Evidence:** _pending_.
- [ ] **BM-032 — CRM-lite and pipeline event sourcing (P1).** Simple statuses, activity, source, deal value, owner and next action. **Evidence:** _pending_.
- [ ] **BM-033 — Tokenized proposal view/response (P1).** Scoped view, download, request changes, acceptance intent, token revoke/expire. **Evidence:** _pending_.
- [ ] **BM-034 — Communications adverse-case tests (P0).** Replay/retry race, reply-before-send, bounced/invalid recipient, token expiry. **Evidence:** _pending_.

**Phase 3 gate:**

- [ ] No external send without exact approvals, and no duplicate send on retry.
- [ ] Recipient reply/suppression or won outcome prevents a due reminder.
- [ ] Provider events and CRM record agree; public link reveals no private data.

---

## 7. Phase 4 — Commercial operations and launch

- [ ] **BM-035 — Production marketing lead funnel (P1).** Attachments, privacy, conversion attribution, notifications; production provider/permissions. **Evidence:** _pending_.
- [ ] **BM-036 — Template-based contractor websites/release control (P1).** Reusable templates, verified claims, page copy, forms, SEO basics, preview/approve/publish with release hash. **Evidence:** _pending_.
- [ ] **BM-037 — Operator console (P1).** Jobs, approvals, costs, error states, accounts and releases. **Evidence:** _pending_.
- [ ] **BM-038 — Stripe billing and entitlement events (P1).** Setup/subscription, signed webhooks, idempotent billing state. **Evidence:** _pending_.
- [ ] **BM-039 — Event-backed monthly report (P1).** Accurate wins, decided win rate, value, trend coverage, operator review. **Evidence:** _pending_.
- [ ] **BM-040 — Observability and runbooks (P0).** Stuck sends/jobs, failure traces, logs, alerting, replay, backup restore test. **Evidence:** _pending_.
- [ ] **BM-041 — Security and legal/privacy review (P0).** Access, retention/deletion, claims, email consent, proposal acceptance, data processors. **Evidence:** _pending_.
- [ ] **BM-042 — Accessibility/SEO/performance final pass (P1).** Working 375px menu, keyboard, labels, page semantics, genuine location content, performance. **Evidence:** _pending_.
- [ ] **BM-043 — Client/operator onboarding and support playbook (P1).** Document customer responsibilities, approval limits, manual fallback and included features. **Evidence:** _pending_.
- [ ] **BM-044 — Staging-to-production rehearsal (P0).** Full synthetic workflow, true webhooks, observability, recovery and rollback. **Evidence:** _pending_.

**Phase 4 pilot readiness gate:**

- [ ] Real production infrastructure, ownership, access and backup are documented.
- [ ] Privacy/security/legal risks reviewed, with no unclosed critical blocker.
- [ ] One full synthetic cleaning tenant end-to-end test recorded against production-like stack.
- [ ] Operator can identify stuck/failed activity and recover safely.

---

## 8. Phase 5 — Pilot validation and early revenue

- [ ] **BM-045 — Build primary-niche cleaning case studies (P1).** Truthfully labeled fictional demos, not fake client claims. **Evidence:** _pending_.
- [ ] **BM-046 — Onboard consented pilot contractors (P1).** Approved facts, pricing, privacy controls, service expectations. **Evidence:** _pending_.
- [ ] **BM-047 — Measure speed, accuracy and reviewer time (P1).** Median/p95 flow time, price correction rate, hours/client, send failure rate. **Evidence:** _pending_.
- [ ] **BM-048 — Measure funnel and conversion (P1).** Leads, proposals, chosen tier, wins/losses, false attribution avoidance. **Evidence:** _pending_.
- [ ] **BM-049 — Validate packages and unit economics (P1).** Setup labor, recurring cost and margin, package allowances, churn and support. **Evidence:** _pending_.
- [ ] **BM-050 — Pilot release decision and focused improvement list (P1).** Document customer evidence, unresolved risks and next niche/feature decision. **Evidence:** _pending_.

**Phase 5 scale gate:**

- [ ] Real usage supports usefulness beyond synthetic demos.
- [ ] Pricing/contract value, provider costs and human QA labor are measured.
- [ ] No unresolved high-severity safety, data or external-send issue.
- [ ] Operator approves next commercial/niche expansion based on evidence.

---

## 9. Phase 6 — Only on an explicit evidence-based trigger

- [ ] **BM-051 — Advanced CRM/project integrations (P3).** Requires repeated customers requesting a specific integration and proof of time saved.
- [ ] **BM-052 — Additional contractor niches (P3).** Pressure washing and landscaping require distinct verified pricing/scope templates and a pilot case.
- [ ] **BM-053 — Visual website builder (P3).** Requires enough ongoing manual edit volume to justify maintenance.
- [ ] **BM-054 — Expanded portal/contract workflow (P3).** Requires legal design and measured customer need.
- [ ] **BM-055 — Additional QA capacity (P2/P3).** Revisit human QA Coordinator from operations plan when recurring reviews approach ~15 hrs/week.

---

## 10. Regression cases never to delete

- [ ] Harbor Coast minimum fee: $400 standard / $360 discounted studios cannot silently pass $450 rule.
- [ ] Harbor Coast 1BR $500 → $450 and 2BR $600 → $540 after 10% discount.
- [ ] Harbor Coast heavy-condition 1BR example: $500 × 1.40 = $700 before other adjustments.
- [ ] Quarterly touch-up scope and $475 fee cannot be both included and additional.
- [ ] Unknown RRP/license/COI verification cannot be displayed as a confirmed credential.
- [ ] Proposal PDF acceptance checkboxes are legible; pricing table remains together; all text within bounds.
- [ ] PDF contains no internal operator notes or previous customer's name.
- [ ] Marketing and contractor forms do not show success when persistence fails.
- [ ] A proposal edit invalidates all approvals bound to a prior content hash.
- [ ] Two-tenant read/write/storage-access negative cases are enforced.
- [ ] Reply/bounce/accept/opt-out suppresses pending follow-ups.
- [ ] Duplicate webhook or job replay does not double-send.
- [ ] Untrusted transcript instructions cannot authorize publishing or sending.
- [ ] Missing direct costs never lead to false margin compliance.
- [ ] No missing/skipped CI check may count as a passed launch gate.

---

## 11. Decision and blocker register

| ID | Current blocker/decision | Default safe action | Owner | Status |
|---|---|---|---|---|
| DEC-01 | Durable repo/current deploy unknown | Inspect before mutation | Engineering | Open |
| DEC-02 | Harbor Coast studio minimum exception | Reprice or request owner approval | Contractor/operator | Open |
| DEC-03 | $475 quarterly touch-up interpretation | Do not finalize ambiguous proposal | Contractor/operator | Open |
| DEC-04 | Current PDF hosting/render stack | Spike/refactor existing ReportLab first | Engineering | Open |
| DEC-05 | AI/transcription processor and retention | No real customer audio until approved | Operator/security | Open |
| DEC-06 | Email delivery/reply provider | Do not automate outbound until verified | Operator/engineering | Open |
| DEC-07 | Contract/acceptance legal intent | Record customer intent, no binding guarantee | Operator/counsel | Open |
| DEC-08 | Package allowances/cost ceilings | Measure pilot costs first | Product/operator | Open |

Add discovered blockers with an owner, consequence, and next action. Do not invent human decisions.

---

## 12. Completed work log — append only after verification

| Date | Ticket | Branch / commit / PR | Tests and evidence | Deployed where | Remaining caveat |
|---|---|---|---|---|---|
| — | — | — | — | — | No completed work verified in this tracker |

**Example required evidence format (not an actual entry):** `2026-MM-DD | BM-012 | branch + commit | 31 pricing tests pass, HC fixture PDF inspected | staging URL | tax policy excluded pending review`.

---

## 13. Resume protocol / next-turn command

> Continue BidMason using `BIDMASON_MASTER_IMPLEMENTATION_PLAN.md` and this tracker. Inspect actual durable project/repository state and existing work first. Reconcile tracker entries with what exists; do not duplicate changes. Work on the highest-priority unblocked item, implement and validate it now, keep the solution DRY/KISS/YAGNI/SOLID, and preserve all approval, pricing, evidence and tenant-security gates. Update this tracker only with verified changes and evidence. Report exact files, tests, deployment status, blockers and next step. Missing or skipped checks must not count as green.

```text
BIDMASON STATUS
BASELINE: [source/branch/commit actually inspected]
PHASE: [P0-P6]
COMPLETED: [IDs + evidence]
IN PROGRESS: [ID]
TESTS: [what actually ran and results]
BLOCKERS: [exact reason or none]
NEXT: [highest unblocked ID]
RELEASE: [unverified / local / staging / production + evidence]
```