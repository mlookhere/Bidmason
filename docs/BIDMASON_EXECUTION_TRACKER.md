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
---

## 14. Verified GitHub bootstrap progress (2026-10-14, local Pacific; 2026-10-15 UTC)

**Not a closed BM ticket, not a production release.** The verified branch is `work/2-scaffold-ci` at commit `64ec3d00e5b1053bc868e1603db45b4f36c60132`, source branch `dev` with PR [#10](https://github.com/mlookhere/Bidmason/pull/10).

- Repository confirmed `mlookhere/Bidmason`, public, with `main` and `dev`.
- GitHub control Issue [#1](https://github.com/mlookhere/Bidmason/issues/1) plus 8 delivery Issues [#2–#9](https://github.com/mlookhere/Bidmason/issues) created.
- Source documentation imported: **full** 77 KB blueprint and 19 KB tracker from user-provided Project files.
- From original ZIP: `operations/pricing-and-packages.md` and `operations/qc-checklists.md` imported with SHA-256 equality assertions. Remaining 30 original archive entries have not been imported.
- Original archive's 32 files inventoried with sizes and SHA-256 prefixes at `docs/SOURCE_INVENTORY.md`.
- CI changes: `ci/run fast|pr|security` runs non-empty test suite; skips, expected failures and missing tests fail; policy tests cover pinned Actions, branch/job checks, unsafe permissions/checkout credentials, remote pipes, Claude tools and basic secret patterns.
- **Actual evidence:** [Actions run 38692196037](https://github.com/mlookhere/Bidmason/actions/runs/38692196037) for commit `64ec3d0`, **fast, pr, security all concluded success**; PR job log: **15 tests run, 0 skipped**, plus policy and pattern checks. Earlier red [run 38691821815](https://github.com/mlookhere/Bidmason/actions/runs/38691821815) was fixed by correcting Python test discovery path. Nothing was bypassed.
- **Remaining gate:** original ZIP content, real product/app toolchain, customer-form persistence, database/auth, proposal pricing/renderer, security integration tests, provider work and deployment are still unimplemented or unverified. `BM-001` and [PLAN 1/8] remain open. No production release is authorized.

---

## 15. Continuation evidence — 2026-10-14 local / 2026-10-15 UTC

**Partially implemented; no ticket is marked complete.** The preexisting `[PLAN 1/8]` Issue [#2](https://github.com/mlookhere/Bidmason/issues/2) and draft [PR #10](https://github.com/mlookhere/Bidmason/pull/10) are being resumed, not duplicated.

- The user-uploaded `bidmason.zip` was inspected directly: **32 files**, source snapshot June 2026. Exact original source text for **28 of 32 files** has been committed to the work branch and compared to the corresponding original Git blob hashes.
- Added `ci/source_integrity.py` with positive and adversarial (missing/tampered) tests; `ci/run fast|pr|security` now runs source-integrity as a required gate. All nine role prompts and all eight operating policies are preserved without rewriting. Original company README is archived as `docs/HISTORICAL_SOURCE_README.md` to avoid replacing the real GitHub README and to prevent stale runtime directions being mistaken for current policy.
- Exactly four historical assets remain to import: `bidmason-website.html`, `demo-clients/harbor-coast-painting/04-website-harbor-coast.html`, `demo-clients/harbor-coast-painting/make_proposal_pdf.py`, and `demo-clients/harbor-coast-painting/harbor-coast-proposal-unit-turn-program-v2026-06-11.pdf`.
- Last verified before writing this entry: commit `6ab6f89856c89e32d100d7e8beefd5469aa7e137`, [GitHub Actions run 38694146455](https://github.com/mlookhere/Bidmason/actions/runs/38694146455): **fast/pr/security completed successfully**, PR job log **20 tests run, zero skipped**, **28 source files byte-exact**, 4 substantive PR-stage gates passed.
- Historical demo claims, false form confirmations, below-minimum prices and contradictory charges remain unsafe for publication. No customer-facing forms, authenticated backend, deployment, production billing or external sends have been tested. Source-import evidence is not evidence of a functioning application.
- **Next:** import the four remaining assets as nonpublished historical sources, add appropriate PDF/layout and CI build checks, then decide whether Issue #2 is fully satisfied. If not, leave the draft PR and Issue open with exact blockers.

---

## 16. Development preview and real build gates — October 15, 2026

**Issue #2 is still OPEN; PR #10 is still DRAFT. No release or customer approval is implied.**

- Created a private-preview-only Next.js 16.4.0 / React 19.3.1 / TypeScript 6 application with semantic navigation, responsive styling, reduced-motion behavior, clear limitations, and search-engine noindex. Original fake form-success scripts were **not imported into live UI**; no actual form/backend was created.
- Generated the exact npm lock on a successful GitHub Actions web-build and committed it. The current web-build runs **`npm ci`**, `npm audit --audit-level=high --omit=dev`, TypeScript typecheck, `node --test` for preview constraints, real Next production build, and a native Node HTTP smoke test of the running production server.
- Evidence: commit `b5330a0c50712aec3e5ba20454d5d23be09c16ad`, [GitHub Actions run 38747877843](https://github.com/mlookhere/Bidmason/actions/runs/38747877843): **fast, pr, security and web-build all completed successfully**. PR job executed **23 tests**, none skipped, **28 original archive files match byte-for-byte**, workflow policy and basic pattern scans passed. Web-build installed from lockfile, **reported 0 npm vulnerabilities**, completed Next 16.4.0 production compilation and passed real HTTP preview checks.
- Four original ZIP entries remain unimported: two historical HTML websites, the ReportLab PDF generator, and the PDF output. There is still no tenant/auth service, persistent intake, approved quote/pricing/PDF engine, outbound email, billing, CRM, or verified deployment. Correctness of these features has not been tested or claimed.
- Following task: finish historic source import safely, then complete item 1's scaffold acceptance without mislabeling historical draft output as a live feature. Leave all release/approval gates in place.

---

## 17. Historical publication controls and real PDF recheck — October 15, 2026

**Issue #2 remains open and PR #10 remains draft.** The four non-text source artifacts are in the supplied ZIP, not the repository.

- Commit `41c3c987ed4813f09da7f592c4b44d4c5be948d8` adds a fail-closed `ci/publish_guard.py` to the fast, PR, and security stages. It blocks historical demo filenames and quarantine directories in Next/public source paths, obvious fake form-success handlers, accidental removal of `noindex`, and removal of the preview's no-intake notice. Six negative/positive regressions were added, checked locally and by GitHub.
- **Evidence:** [Actions run 38861748007](https://github.com/mlookhere/Bidmason/actions/runs/38861748007) — all **four jobs successful**. The PR job ran **34 tests with zero skipped**, verified **28/28 original imported source hashes**, passed publication guard, workflow policy and limited secret scan. This is a secure-preview gate, not production application security certification.
- The actual 4-page original Harbor Coast PDF (source SHA-256 `23d380df90280a10eb1d5f14127758314b348720b24a7e3eb3db09e5e074bc4f`) was rendered and text-extracted. Its pricing table wraps “Heavy-condition” mid-word on page 2; option boxes appear as **filled squares**; Full Property marks quarterly touch-ups “included” while also billing **$475/visit**; studio rates **$400/$360/$360** do not meet the client-stated **$450 minimum**, absent a separately documented exception. These are independently observed blocking defects and **are not fixed**. Evidence and acceptance guidance recorded on [Issue #3](https://github.com/mlookhere/Bidmason/issues/3).
- The current preview is not access-controlled. The `robots` noindex setting is **not privacy or authorization**; do not deploy or submit customer data until authentication/storage/retention decisions and gates are implemented.
- Next: finish source archive and build foundations in Issue #2, then address actual PDF/pricing/claim defects in Issue #3 with business decisions backed by real tests. Do not merge based on green checks for incomplete scope.

---

## 18. Full original-source recovery and GitHub CI evidence — October 15–16, 2026

- The four remaining original files have now been saved on `work/2-scaffold-ci` in the **non-served** `historical-source/legacy-assets.lzma.b64` bundle. This is a lossless encoded copy of the actual uploaded source. The restoration code `scripts/source_bundle.py` authenticates archive SHA-256, the entire decompressed payload, and each original asset's exact length and digest. No old form, script, or PDF is included in Next's `public/` or `app/` paths.
- The original **32/32 file source-preservation requirement is complete and independently verified**, comprising 28 Git blob identity tests and four authenticated archived binaries/text files. This does **not** resolve historic pricing/PDF/fake-form defects, does **not** establish a deployed product, and does **not** mark the later BM tickets complete.
- Initial archive CI [run 38863699228](https://github.com/mlookhere/Bidmason/actions/runs/38863699228) failed because direct invocation of `ci/source_integrity.py` lacked the repository root on Python's import path. The causal fix was committed as `08de350dda0659820a6d45821a4b90ef4a7b930c` with no tests removed or thresholds weakened.
- **Passing evidence:** [Actions run 38863783438](https://github.com/mlookhere/Bidmason/actions/runs/38863783438) at `08de350d`: fast, PR, security and web-build all succeeded; PR job ran **40 tests with zero skipped** and reported `PASS: 32 original archive files verified (28 loose + 4 quarantined)`; published-source guard, workflow policy, limited security pattern scan, TypeScript/Next build and HTTP smoke remained required.
- Outstanding project scope: correct the sample demo in Issue #3; implement canonical tenant-safe app, pricing, approvals, PDF rendering, persistent forms, delivery, billing and release via Issues #4–#9. The source archive remains historical and private only by location, not access control.

---

## 19. Native Windows and scaffold integration gate — 2026-10-16 UTC

- Added native `scripts/bootstrap.ps1` and `ci/run.ps1` entrypoints, and a **required** `win-fast` GitHub job on Windows with Python fast checks, restored source archive validation, locked npm dependency install, TypeScript tests and Next production build. It runs alongside Linux fast, PR, security and web-build.
- Initial [run 38864170522](https://github.com/mlookhere/Bidmason/actions/runs/38864170522) failed correctly: Windows checkout converted original text LF to CRLF, invalidating byte-level source hashes, and one test assumed Unix separators. Fixed the *causal errors*, preserving all checks: `.gitattributes` now pins LF for text across platforms; archive restore tests inspect Path.parts rather than literal `/`.
- [Actions run 38864273304](https://github.com/mlookhere/Bidmason/actions/runs/38864273304) on `6badc613714701dd98eb4d573981cd01fe849f06`: **all 5 jobs completed successfully**. Windows job ran **43 tests, zero skipped**, verified **32/32 original archive files**, passed the real publication guard, completed npm install and Next production build. Linux fast, PR, security and web-build also completed successfully.
- **Slice 1 is implemented and tested** as an independently deliverable *scaffold*: full historical source preservation, transparent non-public preview, ChatGPT-only GitHub operating contract, complete Linux/Windows headless gates and reproducible build. The underlying SaaS remains intentionally unfinished and is tracked in Issues #3–#9. No production deployment, customer use, or main-branch release is implied.

---

## 20. First Harbor Coast pricing and PDF QA — October 16, 2026

Issue [#3](https://github.com/mlookhere/Bidmason/issues/3), draft [PR #11](https://github.com/mlookhere/Bidmason/pull/11) on `work/3-demo-qa`, base `dev` at scaffold merge `25f5bce0`.

- Added `lib/pricing.ts`, an integer-cent calculator for synthetic unit-turn fixtures using the documented formula **base + surcharge, then discount, then re-apply minimum, then multiply by quantity**. No silent minimum waivers; explicit adjustment recorded; missing direct costs yield unverified margin.
- Automated Harbor Coast cases: studio as-needed $400 historical now $450, studio volume $360 now $450, 1BR volume $450, 2BR volume $540; 1BR heavy +40% before discount totals $700; included **and** additionally billed $475 quarterly touch-up is rejected. Fractional-cents, invalid quantities/currency and money overflow are negative tests.
- Added the independent synthetic **two-page ReportLab** output renderer `scripts/render_demo_pdf.py` driven only by already-priced `fixtures/demo_snapshot.json`. This is a **non-deliverable demo** with no verified CSLB/insurance claims; it explicitly labels a simulated **unapproved** $0 additional quarterly inclusion assumption, rather than falsely claiming a contractor decision. It uses drawn vector empty boxes and avoids historical glyph corruption.
- [GitHub Actions run 38865863067](https://github.com/mlookhere/Bidmason/actions/runs/38865863067), commit `d10a0748c67146f3d37be147a5979dd300acc471`: separate required `pdf-qa` job **succeeded** with ReportLab 4.4.9 and PyMuPDF 1.26.7; independently extracted text/prices, checked all two pages' visible bounds, rendered raster pages, detected three vector boxes, checked no credential/internal note leaks and rejected a contradictory included-plus-billed revision. Linux fast/PR/security/web-build succeeded; Windows was still completing when this note was authored and its success must be checked separately before promotion.
- Original historical PDF remains unchanged in source quarantine. The synthetic output has been visually inspected, but **no owner-approved price exception or final quarterly business decision exists**. Real marketing/demo forms are not connected, and mobile 375px/keyboard E2E still requires evidence. [PLAN 2/8] is **in progress**, not complete; no promotion to `dev` until all issue acceptance criteria and required Actions are met.

---

## 21. Real browser validation and negative intake QA — 2026-10-16

- Resumed existing draft [PR #11](https://github.com/mlookhere/Bidmason/pull/11) on `work/3-demo-qa` from previously verified `dev`. No duplicate issue/PR or direct `dev`/`main` mutation.
- The preview now uses proper **top-level banner/main/contentinfo landmarks**, visible keyboard-first **Skip to main content** link, anchored main focus, 44px-tall nav touch targets, improved foreground contrast and reduced-motion scrolling. The preview's metadata no longer describes its not-access-controlled site as "private."
- Added pinned Python Playwright 1.57.0 and a separate, **required** `browser-e2e` Actions job. It builds and starts actual Next production, opens Chromium and tests **320, 375, 768, 1280px** viewports, DOM layout overflow, landmark semantics, Tab/Enter skip-link behavior, keyboard focus outline, mobile nav touch targets, live link targets, reduced-motion preference, no forms or outbound mutations, no misleading lead endpoint, no publicly exposed original assets, noindex and no JS errors.
- [Actions run 38869258287](https://github.com/mlookhere/Bidmason/actions/runs/38869258287) on `1cc9b2eb58b41a0a6e34a50a03304fca208a2d18`: **all seven jobs completed successfully** (fast, PR, security, web-build, win-fast, pdf-qa, browser-e2e). Chromium log explicitly passed all four viewport checks and quarantine/non-intake route checks. Screenshots were created in temporary job storage only; **no durable screenshot artifact was uploaded**.
- Publication controls are intentionally preview-specific, **not a substitute** for production form persistence, authentication, tenant isolation, credential verification or full accessibility certification.
- Issue #3 remains **open** and PR #11 remains **draft**. The historic Full Property quarterly touch-up price is ambiguous: “included” and “$475 per visit” contradict. The non-deliverable PDF fixture's `$0 extra` is explicitly simulated, **not owner-approved**. Completing the original external commercial pricing policy requires an authorized human choice before a deliverable/sent proposal can be approved. No legal/credential claim is approved for external use.

---

## 22. Remove even simulated quarterly assumptions — 2026-10-16

- The earlier demo PDF fixture temporarily represented a **prominently labeled** assumption of “included at $0 additional”, solely for visual QA. That historical work log remains an accurate record of what the earlier commit tested; **it is no longer the current behavior**.
- On branch `work/3-demo-qa`, fixture `fixtures/demo_snapshot.json` now sets quarterly `status=pending-owner-approval`, `included=null` and `additionalCents=null`. The PDF displays **“Terms pending owner approval”** rather than any simulated included/billed promise. The historical $475 standalone figure is context only.
- `scripts/render_demo_pdf.py` rejects **any explicit quarterly inclusion or additional charge** before an authorized owner decision. Negative PDF QA tests fail if a client-facing PDF could be generated from an assumed included, assumed billed or contradictory policy. The PDF remains stamped **SYNTHETIC DEMO - NOT FOR DELIVERY** on every page.
- The E2E browser pipeline's [run 38869258287](https://github.com/mlookhere/Bidmason/actions/runs/38869258287) passed **all seven required jobs**, with real Chromium at 320/375/768/1280 and no forms/legacy routes. The newest pricing/QA commits require their **own** completed Actions evidence before any promotion.
- The remaining **human-required commercial decision** for the Full Property tier is unambiguous: (A) quarterly common-area visit included at no additional charge or (B) billed separately at $475 per visit. This is a synthetic case, but the original brief does not resolve it. No arbitrary default, credential verification or binding/legal proposal policy can be inferred.
- Until the choice is explicitly approved and the fixture/renderer/tests are updated, [Issue #3](https://github.com/mlookhere/Bidmason/issues/3) stays open and draft [PR #11](https://github.com/mlookhere/Bidmason/pull/11) stays unmerged. `dev` and `main` are unchanged during this slice.

---

## 23. One platform, company-specific pricing — October 16, 2026

- Owner clarified BidMason is **one configurable multi-company system**, not a bespoke Harbor Coast Painting pricing/workflow application. No universal $450 minimum, $475 touch-up, paint packages or fixed service lists. This updates the operative Step 2/4/5 plan and does not erase historical examples.
- **Step 2 decision re-scoped:** There is no need for the owner to select an arbitrary inclusion or billing rate for a historical synthetic proposal. The contradictory quarterly terms stay **unset/pending** and impossible to print as approved price/inclusion. Current PDF/price/claim/mobile/disabled-form fail-closed regression gates remain intact; no customer delivery becomes authorized.
- Implemented `lib/company-pricing.ts` as a pure company-configurable evaluator and `tests-web/company-pricing.test.mjs` using separate synthetic painting and cleaning configurations, distinct minima, optional included work, discount/surcharge orders, numerical validation and reject-on-pending behavior. This is a stepping stone, **not** the production pricing backend.
- The general platform architecture is captured in `docs/COMPANY_POLICY_ARCHITECTURE.md`. Tax, legal/regulatory, company-specific source authorization, persisted policy versioning and role-based commercial approvals remain scheduled for later implementation slices.
- Do not mark original 2026 Harbor Coast PDF as approved or overwrite source evidence. Step 2 may proceed to internal QA/review without an arbitrary fictional $475 business choice once new CI checks succeed; this does **not** loosen any approval/claim/security gate.


---

## Issue 4 tenant security work log (preserved on merge)


---

## 20. Separate fact verification, least-privilege inserts and authentic CI evidence — October 16, 2026 PT

**Current slice:** Issue [#4](https://github.com/mlookhere/Bidmason/issues/4), draft [PR #12](https://github.com/mlookhere/Bidmason/pull/12), branch `work/4-tenant-rls` created from `dev`. Issue [#3](https://github.com/mlookhere/Bidmason/issues/3)/draft [PR #11](https://github.com/mlookhere/Bidmason/pull/11) remain separately blocked on the historical Harbor Coast quarterly pricing choice; no approval was inferred.

- The tenant PostgreSQL model now includes **six RLS-enabled tables**: organizations, memberships, submitted business facts, immutable fact reviews, brief revisions and brief approvals. The new review table records a separate explicit **owner/operator** decision, a nonblank evidence reference, review rationale, database-owned reviewer identity and timestamp. A `security_invoker` verified-facts view returns only approved review events visible to the caller's tenant. A user-submitted fact alone does **not** become a publishable verified credential.
- Authenticated INSERT privileges are restricted **by column**: clients cannot supply `approved_at`, `reviewed_at`, `created_at` or impersonate the database-owned submission/approval reviewer fields. Client write access remains append-only; client members cannot update/delete fact reviews or edit memberships.
- Added a second **required** PostgreSQL 17 suite, `ci/db_fact_review_test.sql`, exercising reviewed/unreviewed visibility, operator review, contractor denial, tenant B isolation, empty evidence rejection, timestamp spoofing, missing identity and grant assertions. The first suite still verifies tenant briefs, revision hash checks, stale approval invalidation and RLS on all tables and security-invoker views.
- **Verified:** [Actions run 38993925139](https://github.com/mlookhere/Bidmason/actions/runs/38993925139) at commit `613b3da04393355dacd567227fbb4c53490686ad`: **all six jobs succeeded** (fast, PR, security, web-build, win-fast, db-rls). PostgreSQL log explicitly reported `PASS: reviewed-fact RLS, independent operator review, tenant isolation, blocked timestamp forgery, verified-only view`.
- **Out of scope / not claimed:** This remains an **isolated PostgreSQL** schema proof, not a deployed Supabase project, generated migration, authenticated backend or credential-validation authority. A text evidence reference does not prove the referenced document is genuine or private. Real Supabase Storage bucket policies, access control, auth/session, secure org onboarding, evidence integrity, security advisors and two real sessions still require an authorized dedicated BidMason project and executable tests before the slice can merge or production data can be accepted.
- No CI thresholds were lowered and no checks were skipped, and `dev` and `main` were not modified by this PR.

---

## 21. Tenant-private evidence Storage draft and adversarial CI — October 16, 2026 PT

- Resumed the existing [Issue #4](https://github.com/mlookhere/Bidmason/issues/4) on `work/4-tenant-rls`, [draft PR #12](https://github.com/mlookhere/Bidmason/pull/12), without modifying `dev`, `main` or any live Supabase project. Verified current connected projects are **Free the music** and **Proofmode**, neither is authorized as BidMason.
- Added `db/storage_policies.sql`, a **draft** private `bm-evidence` bucket and `storage.objects` RLS policies: 15 MiB upload cap and PDF/PNG/JPEG bucket allowlist, canonical organization-ID/object-ID path, uploader JWT owner check, tenant member uploads, owner/operator or uploader-only read, and no client UPDATE/DELETE policies. The existence of these policies in GitHub does **not** imply actual Supabase Storage policies are installed, compatible, or exclusive; existing live Storage policies will require separate audit.
- Added `ci/db_storage_stub.sql` (explicitly CI-only mock of Supabase Storage tables) and `ci/db_storage_test.sql` with real PostgreSQL roles checking correct-org upload, owner identity, rejected cross-tenant/unsafe-path/wrong-bucket uploads, contractor cannot see another contractor's files, owner can see organization files, missing identity no read, and no overwrite or deletion.
- Made the Storage schema install and negative RLS suite required inside the existing `db-rls` GitHub Actions job. Added missing-step adversarial policy tests so it cannot silently disappear from CI.
- Initial [run 38994337918](https://github.com/mlookhere/Bidmason/actions/runs/38994337918) surfaced an assertion bug: an unauthorized PostgreSQL UPDATE can affect **zero rows** instead of raising an exception. Fixed the test to verify `FOUND`/affected rows rather than expecting an exception; did not change Storage policies or weaken gates.
- [Actions run 38994401361](https://github.com/mlookhere/Bidmason/actions/runs/38994401361), commit `d95d15c27eff233667db6dfe23bbb57a94cd0af1`: PostgreSQL `db-rls` job succeeded with the new Storage checks, and Linux fast/PR/security/web-build succeeded. The Windows job was still running when this entry was prepared, so **do not claim full latest-head gate success until Windows completes successfully**.
- Remaining Item 3 blockers are production Supabase project authorization, generated migration, real sign-in/role assignment, Storage upload/download integration, signed URL policies, evidence integrity/retention, project security advisors and live two-tenant session tests. The private Storage policy is provisional and does not establish authentic business credentials, encrypted object retention or a compliant production service.

---

## 22. Same-tenant immutable receipt verification and membership revocation — October 16–17, 2026

- Resumed Issue [#4](https://github.com/mlookhere/Bidmason/issues/4), draft [PR #12](https://github.com/mlookhere/Bidmason/pull/12) on `work/4-tenant-rls` from GitHub state; `dev` and `main` remain unchanged.
- Added a separate additive `db/evidence_receipts.sql` schema draft: a **seventh RLS-protected table** recording the canonical tenant-prefixed evidence path, SHA-256 digest, content type, size, and server-issued timestamp. Authenticated users have tenant-scoped read permission only; no client role can issue, alter, or delete receipts. The composite `(organization_id, evidence_reference)` foreign key on fact reviews forbids invented paths and evidence receipts belonging to other organizations.
- `ci/db_receipt_seed.sql` contains privileged **synthetic** receipt fixtures and no real private file bytes; `ci/db_receipt_test.sql` exercises real PostgreSQL rejection of forged/missing/cross-tenant receipts, malformed digests, wrong tenant path and oversize inputs, and all seven RLS tables. Added a second regression demonstrating that after trusted-backend membership removal, an unchanged JWT identity cannot read tenant records or private Storage metadata or submit facts.
- `lib/evidence.ts` creates **candidate** receipt fields by hashing actual input bytes and deriving an object path from canonical UUIDs, validated file signatures and permitted MIME types with a 15 MiB size ceiling. `tests-web/evidence.test.mjs` checks the digest, normalized path and malformed/oversized/spoofed inputs. This is **not** a deployed ingestion endpoint, malware scan, proof of genuine credentials, or attestation that any Supabase Storage object actually exists.
- [Run 38994853965](https://github.com/mlookhere/Bidmason/actions/runs/38994853965) at `7af7ae02` successfully completed **all six required jobs**, including the first SQL receipt FK and forged/cross-tenant negative scenarios. Subsequent CI exposed two test-authoring errors (a numeric-only UUID that did not change when uppercased, and malformed PostgreSQL dollar quoting). Both were corrected without suppressing checks or weakening controls. **Latest code** commit `d74ad21c4d0897bf1c68cd55680b04272497af2f` requires its own completed Actions run before any promotion; do not reuse the earlier success as evidence of latest-head success.
- Still required for Item 3: a dedicated, authorized BidMason Supabase project; real generated migrations; securely authenticated onboarding; private upload/download tests against Supabase Storage; server-side comparison of receipts to stored bytes; retention/revocation and signed URL controls; project security advisors; and at least two real tenant sessions. **No live project was changed**. Issue #4 and PR #12 remain OPEN/DRAFT.

---

## 23. Effective Storage policy-set collision guard — October 16–17, 2026

- Resumed existing Issue [#4](https://github.com/mlookhere/Bidmason/issues/4) on draft [PR #12](https://github.com/mlookhere/Bidmason/pull/12), branch `work/4-tenant-rls`; original `dev` and `main` were not changed.
- Reviewed current Supabase Storage access-control behavior: multiple permissive PostgreSQL RLS policies can combine, meaning the two intended private-bucket policies are **not sufficient evidence by themselves** that some other policy does not widen reads/writes.
- Added read-only (except for a session-temporary function) `db/storage_policy_audit.sql`: verifies private bucket, 15 MiB cap, three allowed MIME types, `storage.objects` RLS enabled, exact two expected policy names, expected `authenticated` roles/read/insert operations and required tenant/owner predicate text. It **fails closed** for any unreviewed extra Storage object policy, even one apparently intended for another bucket, pending authorized manual scope evaluation.
- Added `ci/db_storage_audit_test.sql`: adversarial PostgreSQL transactions inject a broad extra SELECT policy, weaken the allowed INSERT to `true`, and weaken SELECT to `true`. The auditor must reject each scenario; transactions roll back and the original policy set must pass. The joint `psql -f db/storage_policy_audit.sql -f ci/db_storage_audit_test.sql` step is mandatory in the existing `db-rls` Actions job; Python workflow-policy negative tests reject its removal.
- **Verified:** [Actions run 38995504936](https://github.com/mlookhere/Bidmason/actions/runs/38995504936) at commit `95cdc3d944a3e7cb6b7563611371695f4121ed27`: **all six required jobs SUCCESS** (fast, pr, security, web-build, win-fast and real PostgreSQL `db-rls`). No skipped/missing gate was counted as green.
- **Limitations:** Introspection is a conservative preflight, not a semantic proof of arbitrary policy expressions; the isolated Storage stub is not the live Supabase Storage API. The final authorized project must be checked for policy interaction, Auth identity, signed-URL behavior, actual file ingestion/hash verification, migration history and security advisors using real tenant sessions. This work is not production deployment or approval of business credentials.

---

## 24. Bucket-scoped restrictive Storage policies and adversarial validation — October 16–17, 2026

- Resumed existing [PR #12](https://github.com/mlookhere/Bidmason/pull/12) / Issue #4 on `work/4-tenant-rls`; no `dev`, `main` or unrelated Supabase mutation.
- Improved the earlier **audit-only** approach with actual **RESTRICTIVE** PostgreSQL RLS boundaries for reading and inserting `bm-evidence` objects. PostgreSQL AND-combines these with permissive policies, preventing a newly introduced permissive `FOR ALL` or SELECT/INSERT policy from bypassing the tenant/ownership checks. Added restrictive UPDATE/DELETE denial even if another permissive policy grants writes.
- The first draft applied boundaries globally. Revised them to apply **only to `bm-evidence`**, and extended adversarial tests to confirm the same user can still read, insert, rename and delete in another bucket **when that bucket has its own explicit policy**. The effective-policy audit now recognizes and validates six named read/insert/boundary/immutable policies, fails closed on extra policies and detects missing guard predicates.
- Kept the original tenant isolation, forged receipt, revocation and schema tests. New positive/negative SQL tests inject temporary broad policies to validate real RLS behavior rather than trusting only a textual SQL policy inspection. All adversarial mutations roll back.
- Two intermediate failing CI runs correctly exposed SQL-authoring mistakes (policy declaration order and a test diagnostic quote). Both were repaired without weakening checks. [Actions run 38996011391](https://github.com/mlookhere/Bidmason/actions/runs/38996011391) verified **six of six** jobs after those fixes. [Run 38996129584](https://github.com/mlookhere/Bidmason/actions/runs/38996129584) on the bucket-scoped revision `e8aed2fc9d5f881f77a53e1f68496d1ce775e286` had all required jobs except Windows complete and successful when initially recorded; **verify Windows before counting the whole run green**.
- This remains a PostgreSQL isolated simulation using a CI-only Storage table stub. It is **not** permission to deploy, does not prove correctness of live Supabase API behavior or signed URL access, and does not supply customer-facing evidence verification. The connected Supabase projects are unrelated; no real project was changed. Issue #4 and PR #12 remain OPEN/DRAFT, and Issue #3 still requires its separate owner pricing decision.

---

## 25. Atomic candidate migration and fresh-database replay — October 16–17, 2026

- Resumed existing Issue [#4](https://github.com/mlookhere/Bidmason/issues/4) / [draft PR #12](https://github.com/mlookhere/Bidmason/pull/12) on `work/4-tenant-rls`; `dev` and `main` unchanged and neither unrelated connected Supabase project touched.
- Added an **atomic, deterministic candidate migration** `supabase/migrations/20261017000000_bidmason_candidate_baseline.sql` composed from the authoritative four reviewed schema/receipt/Storage/audit SQL sources. `scripts/build_migration.py` reconstructs it with no CI Auth/Storage stubs and no psql-only directives; the `--check` mode fails if the committed candidate drifts from the source files.
- Extended the **mandatory** PostgreSQL 17 `db-rls` Actions job to create a second empty isolated `bm_migration_ci` database, apply the exact candidate atomically, and **rerun the complete positive and adversarial RLS/Storage/review/evidence-receipt suites** independently of the original source-level test database. The original checks remain in place; no gate has been removed.
- The first replay [run 38996493395](https://github.com/mlookhere/Bidmason/actions/runs/38996493395) failed legitimately at the CI-only Auth stub because PostgreSQL roles are shared across databases; this was fixed by conditionally creating already-existing `anon`/`authenticated` test roles. The migration checksum check itself passed before this failure.
- [Actions run 38996557302](https://github.com/mlookhere/Bidmason/actions/runs/38996557302) at `7450d3b1c0319b38e211077085cf791e69c29bd0`: migration checksum, fresh-database migration execution, source-side and migrated RLS tests, fast/PR/security/web-build jobs **completed successfully**; Windows job was still pending when this line was authored and must be explicitly verified. The documentation-only head will have its own CI run.
- The candidate migration is **not live**. Selecting/creating an authorized BidMason Supabase project, verifying hosted Storage DDL privileges and existing policies, real Auth sessions, private uploads and signed-URL behavior, security advisors and two-tenant tests remain prerequisites to any deployment or merging Item 3 to `dev`.

---

## 26. Managed BidMason project, live migrations and authenticated API — 2026-10-16 PT / 2026-10-17 UTC

- Selected the **newly created, authorized** BidMason Supabase project `jgbogpunyzkoytrclqdl` (`mlookhere's Org`, `us-west-1`, PostgreSQL 17.11). `Free the music` and `Proofmode` remain untouched.
- Applied live managed migrations **successfully** using their actual reviewed GitHub sources:
  - `20261017035109` `bidmason_tenant_foundation`: all six canonical tenant tables plus seventh privileged evidence receipts table and composite review foreign key.
  - `20261017035151` `bidmason_evidence_storage`: private 15 MiB `bm-evidence` bucket and all six tenant/owner-scoped Storage policies.
  - `20261017035730` `bidmason_evidence_review_fk_index`: targeted composite foreign-key index after performance advisor reported an unindexed evidence-review FK.
- **Verified managed Supabase state**: `7/7` public tenant tables have RLS, 11 tenant policies, two security-invoker views, anonymous membership read not granted, authenticated evidence receipt insertion not granted, private Storage bucket present and all six Storage policies present. The actual temporary-function-based Storage policy-set audit passed against the live managed project. Security advisors returned **zero current security findings**.
- Verified tenant isolation with a **transaction-and-rollback role simulation** running actual managed `auth.uid()` and authenticated PostgreSQL role. It denied cross-tenant reads/inserts, and a follow-up query confirmed `0` organizations, memberships and facts after rollback. **This does not substitute for two real signed-in Auth sessions**.
- GitHub branch `work/4-tenant-rls` now stores the **three exact applied migration versions**, and the deterministic generator/CI replay is updated accordingly. Removed obsolete all-in-one synthetic candidate migration to avoid duplicate replay. Full Windows/Linux/real PostgreSQL CI was green on prior head `d160dd7c` via [run 39000497287](https://github.com/mlookhere/Bidmason/actions/runs/39000497287) and on account-endpoint head `4338dd8d` via [run 39000721478](https://github.com/mlookhere/Bidmason/actions/runs/39000721478). Newer head requires its own completed all-job run before promotion.
- Added server-only `GET /api/account`, which **fails closed** unless the actual BidMason publishable key is configured in runtime and verifies a bearer token with Supabase Auth before forwarding that same token through tenant-RLS membership reads. Unit tests and production HTTP smoke verify authentication failures, token non-disclosure, disabled-by-default behavior and no-store caching. **No public sign-in, owner provisioning or authenticated customer form is enabled**.
- **Still blocked for Item 3 completion**: set deployment-side key; implement secure Auth invitation/onboarding and real two-account sessions; verify actual Storage API upload/read/write denials, signed URLs, and evidence-byte/hash matching; audit private key isolation and operator claims; reconcile the live advisory report; retain PR #12 as DRAFT and Issue #4 OPEN until complete. Issue #3/PR #11 remains a separate owner-pricing decision. `dev` and `main` remain unchanged.

---

## 27. Step 2 integration and independently reviewed facts — 2026-10-16 PT / 2026-10-17 UTC

- Step 2 merged to `dev` in commit `08e40794829b92e910af1432fd3c2bf7c8cf502e` after **7/7** required jobs passed, establishing one configurable pricing system with independent company-specific policies; its Harbor Coast pricing is synthetic regression data and remains non-quotable when unresolved.
- Reconciled [draft PR #12](https://github.com/mlookhere/Bidmason/pull/12) with updated `dev` using a two-parent merge commit `20308a7d0732c2f1bc10b2c993a3decdb11dea98`, preserving **both** required sets of browser/PDF and PostgreSQL tenant/Storage tests. Initial merge exposed missing Step 2 changes to shared page/CSS/test-runner files; repaired at `1da27306075eba8639cf67a9661502a613af50eb`. CI red runs correctly prevented promotion; tests were not disabled.
- Added `db/review_independence.sql`: RLS now denies owner/operator review of a business fact if `reviewed_by` equals the fact's `created_by`. CI fact fixtures now use a separate contractor submitter and owner reviewer, while explicit self-review attempts fail. Cross-tenant review, forged audit fields and receipt FK checks remain required.
- Applied the actual managed migration `20261017063426 bidmason_independent_fact_review` to **only** authorized BidMason Supabase project `jgbogpunyzkoytrclqdl`. Security advisors had **0** findings. Ran a transaction-and-rollback role simulation using managed `auth.uid()`: self-review denied, different-person review allowed, verified-view visibility correct; follow-up query confirmed **zero** organizations, memberships, facts, reviews or receipts remained. This is not a real two-account sign-in test or validation of actual uploaded bytes.
- Added exact fourth applied migration file, updated deterministic generator and clean-database CI replay to include it. No other connected Supabase project was modified, and `dev`/`main` remain unchanged by this work.
- Remaining: actual Auth users, onboarding, trusted evidence upload/hash verification, real two-account Storage API tests and signed URL/revocation tests. Draft PR #12/Issue #4 stay open until these are verified; latest-head CI must be checked independently.

---

## 28. Verified private evidence readback workflow and combined 8-job CI — 2026-10-17 UTC

- Following Step 2 integration, draft [PR #12](https://github.com/mlookhere/Bidmason/pull/12) contains **all eight** required GitHub checks: `fast`, `pr`, `security`, `web-build`, `win-fast`, `pdf-qa`, `browser-e2e`, and `db-rls`. A previous manual merge initially preserved older page/CSS/PDF runner versions, causing **real CI failures**; corrected without deleting or weakening any gates. [Run 39010367642](https://github.com/mlookhere/Bidmason/actions/runs/39010367642) passed all eight on merge-repair head `1da27306`.
- Reviewed evidence ingestion boundaries and added `ingestVerifiedEvidence()` in `lib/evidence.ts`, a **server-only, adapter-injected workflow core**: validates canonical user/org and source bytes, checks membership using an injected trusted authorization routine, privately uploads under the actor, reads back the exact object, recomputes SHA-256 and byte length, rechecks membership after async work, and permits a privileged immutable receipt only if verification succeeds.
- New `tests-web/evidence-ingestion.test.mjs` covers valid flow, denied tenant membership, mutated downloaded bytes, unreadable/empty objects, mid-flight membership revocation, mutable input buffer, invalid user/content, failed upload and failed privileged receipt write. It does **not** call real Supabase Storage/Auth APIs, implement malware scanning, verify license authenticity, clean orphaned objects or expose a customer upload endpoint.
- Node native ESM tests caught a relative import resolution issue in an intermediate head. Fixed by keeping `ingestVerifiedEvidence()` beside `prepareEvidenceReceipt()` in `lib/evidence.ts` and deleting the redundant module; the failed builds were not treated as passing.
- [Actions run 39010824536](https://github.com/mlookhere/Bidmason/actions/runs/39010824536) at `c19c0ade669da95e85d6ba103089033be6b3aa8a`: **all 8 required jobs SUCCESS**, including Windows, Chromium, PDF and independent PostgreSQL migration replay. A documentation-only commit afterward requires its own CI verdict.
- The live BidMason database's fourth managed migration `20261017063426 bidmason_independent_fact_review` requires a distinct submitter/reviewer. Managed Supabase rollback-only tests confirmed an owner could not verify their own fact, but could verify a contractor-submitted fact; all synthetic test rows rolled back and security advisors returned zero findings.
- Still required: genuine Auth users and invitations, authorization tied to actual sessions, deployment secrets configured server-side, real Storage API upload/download + signed URL/revocation scenarios, full file-format checks, malware policy, orphan cleanup and tenant-owned versioned pricing/workflow persistence. PR #12 stays draft and Issue #4 remains open; `dev` and `main` unchanged by this continuation.

---

## 29. User-scoped Supabase Storage HTTP port — 2026-10-17 UTC

- Resumed [draft PR #12](https://github.com/mlookhere/Bidmason/pull/12) at `efad810a9ff8a4e9c6c383f199e89c80fb554813`, which had **8/8 required GitHub Actions SUCCESS** in [run 39010955459](https://github.com/mlookhere/Bidmason/actions/runs/39010955459). `dev`, `main` and all other Supabase projects were untouched.
- Added `lib/supabase-evidence-port.ts`: a concrete **server-only HTTP adapter** for the dedicated BidMason Supabase project's Auth, PostgREST membership and private Storage endpoints. Validates current caller identity using `/auth/v1/user`, checks tenant membership through the same verified bearer token/RLS, uploads an immutable organization-prefixed key via `POST /storage/v1/object/bm-evidence/<path>` with `x-upsert: false`, and reads it back with `GET /storage/v1/object/authenticated/bm-evidence/<path>`. The existing `ingestVerifiedEvidence()` core validates downloaded content SHA-256/size and rechecks membership before offering a receipt.
- The only privileged stage `issueTrustedReceipt()` remains **injected and intentionally not implemented or exposed**. The port accepts a project-scoped **publishable** key and a real user JWT, not a service-role or secret key, and never takes a user-controlled upstream hostname or Storage bucket. There is **no public upload route, no production service deployment and no customer upload permission change**.
- `tests-web/supabase-evidence-port.test.mjs` uses intercepted HTTP responses to verify expected fixed endpoints, same bearer for Auth/membership/Storage, no upsert, valid roundtrip, wrong Auth identity, failed Storage upload, tampered downloaded bytes, revoked membership, invalid credential types and path traversal. Tests make **no calls to the live Storage API** and do not prove signed-link, API key deployment or malware safety.
- [Actions run 39015944672](https://github.com/mlookhere/Bidmason/actions/runs/39015944672) at `bf43f4032e6d43d22763ae07cb78237b81deb8e3` passed **all 8 required checks**: fast, pr, security, web-build, win-fast, pdf-qa, browser-e2e and db-rls. Latest documentation commit needs its own exact-head verification.
- Read-only Supabase security advisors still returned **zero findings**, and the four managed BidMason migrations remain unchanged.
- **Remaining acceptance:** provision real users (authorized identities only), secure verified session handling, implement and protect a privileged evidence receipt insert with actual readback proof, orphan cleanup, malware/file validation, exercise real Storage API under two authenticated users including revocation and signed URLs, and verify deployment/CI at final HEAD. Item 3 / PR #12 remains OPEN/DRAFT. No gate may be removed, skipped or marked successful without a GitHub result.
