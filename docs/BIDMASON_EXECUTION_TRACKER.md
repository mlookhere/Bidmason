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

## Item 6 proposal-closure checkpoint — 2026-10-22

Continuing existing Issue #7, draft PR #15 and the work/7-delivery-preflight
branch into dev. Previous exact-head GitHub Actions #39745422392 on
c8acbcf146cc23d3393edf521ec7d2080bd93f8f completed all eight required
jobs successfully. New offline work adds a proposal-wide fictional terminal-
deal hold invalidating already reserved in-memory work across revisions
and recipients; six adversarial regression groups cover the safety contract.
Local full Node test execution: 203 passed, zero failed or skipped. The new
commit still requires **separate exact-head GitHub Actions verification**.

This is partial BM-029/BM-031/BM-032 synthetic coverage only: Phase 3
acceptance remains unchecked. H01-H13 real tenant RLS/Storage/Auth, actual
consent, provider-native callbacks, durable transactional dispatch and
independent privacy/security/legal/operations release signoffs remain
unverified. Do not merge, deploy or enable real customer sending.

---

## Item 6 connected environment inventory checkpoint — 2026-10-22

- **Existing durable work:** Issue [#7](https://github.com/mlookhere/Bidmason/issues/7), draft PR [#15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Previous exact-head `fd0c761` passed all 8/8 required Actions jobs; later commits require their **own** checks.
- **Connected read-only discovery:** An ACTIVE_HEALTHY Supabase project named BidMason has nine applied migrations and eight public `bm_*` tables with RLS enabled; exact counts found **zero rows** in those tables. The `bm-evidence` bucket is private with zero objects; eight scoped storage-object policies are present. The quota table's RLS-without-policy INFO finding requires access-intent review; **do not** add an indiscriminate policy. No Supabase Edge Functions are listed. See [the scoped inspection and reproduction queries](ITEM6_CONNECTED_ENVIRONMENT_INVENTORY.md).
- **H01/H02 acceptance:** PARTIAL ENVIRONMENT INVENTORY ONLY. Still **unchecked**: independently authenticated distinct-user PostgREST/RLS cross-tenant read/write denial, revocation, private upload/download/link expiry negative tests. Metadata inventory, simulated fixtures and privileged SQL reads are **not** these tests.
- **H03–H13 acceptance:** All real company policy approvals, signed revision/recipient consent, selected sender/provider, native webhook, durable unique transactional delivery, buyer authentication, privacy/legal/security/ops reviews and written release go/no-go remain unverified.
- **Release:** `releaseState=blocked`, `releaseAuthorized=false`, no production migrations/deployment/customer messages or merges. The release evidence manifest stays H01–H13 unverified and PRs #12–#15 remain draft/unmerged.
- **Next step:** Run the authorized two-synthetic-user staging negative test matrix described in the Item 6 acceptance runbook; collect external artifacts and independent review before updating any release evidence status.

---

## Item 6 H01 authenticated read-only probe checkpoint — 2026-10-22

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), [draft PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. The preceding connected schema inspection and all H01–H13 production holds remain in force.
- **New runnable subset:** [`ci/item6_rls_readonly_probe.py`](../ci/item6_rls_readonly_probe.py), [eight offline regression tests](../tests/test_item6_rls_readonly_probe.py), and [operator instructions](ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md) implement 13 positive/negative read visibility checks across two genuinely authenticated users and two distinct seeded synthetic tenants, including unauthenticated enumeration. The CLI requires explicit `--live-readonly` and protected environment credentials; never transmits a secret/service key, performs writes, or prints identities.
- **Measured offline regression:** Linux fast check at commit `9c209b9580fad0758c60265472d90302d01e0ae5` executed **271/271 Python tests** with zero failures, including all eight new mocked HTTP tests. Later commits require new exact-HEAD CI review. **No live JWT-signed integration run was performed**, and the live database currently has no seeded synthetic tenants; there is **zero** new H01 acceptance evidence.
- **Still BLOCKED:** H01 cross-tenant negative writes, missing memberships, expired/revoked session behavior, complete table coverage and independent operator verification; H02 Storage and all H03–H13 production signoffs. Neither this read-only tool nor green CI grants `releaseAuthorized`. No schema migrations, deployments, sending, actual buyer view or merge.

### H01 membership leakage hardening — 2026-10-22

- **Code correction:** The prior `other-membership` GET filtered by the requesting user's ID in the other organization. That could miss an exposed row owned by **the other real authenticated user**. The probe now first authenticates **both** users via Auth before any tenant access, then checks the other tenant's actual user membership, each tenant's unfiltered membership enumeration, and anonymous membership visibility. Full bounded matrix: **16 read-only checks**.
- **Offline proof:** Four targeted regression groups added (cross-user membership, unfiltered list leakage, anonymous membership visibility, second-user Auth failure before data access). Existing explicit opt-in, no-network default, identity-redacted output and `h01Accepted:false` remain enforced. Interim code-head Linux fast logs showed **275 Python tests passed** at `b14f191077be0cc69a1732d70ae6111702302dbc`; later doc/head commits require independent exact-head checks.
- **Release hold:** This closes a **test-harness blind spot**, not an observed live tenant disclosure. No new live two-user Auth data exists, and H01-H13 stay unverified. PR #15 remains draft; no tenant records created, no sending, no merge or deployment.

### H01 canonical HTTPS origin and GET transport hardening — 2026-10-22

- **Change:** The opt-in H01 probe now requires the exact lowercase canonical `https://<project-ref>.supabase.co` origin *as supplied*, so Python URL parsing cannot silently discard leading whitespace, control characters, trailing separators or embedded CR/LF before a bearer token is sent. No live project, key or token is embedded in source.
- **Transport verification:** Two mocked HTTP regression groups exercise the existing proxy-disabled and redirect-disabled GET-only configuration, per-request timeout, non-followed 302, malformed JSON and >16 KiB response rejection. Added malformed-origin cases that fail before any HTTP.
- **CI root cause and correction:** Early exact-head run [#39786885643](https://github.com/mlookhere/Bidmason/actions/runs/39786885643) showed the fast, PR and security jobs **red** because a test incorrectly asserted `_NoRedirect` was a handler instance, though the code correctly passes the handler **class** to `urllib.request.build_opener`. Fixed the assertion at `3714da841a6ef0dc557a5dce20a73c0f37ee132a` without changing any gates. Exact-head Linux fast log on that fix reports **277/277 Python tests passing**, with H01–H13 still blocked; later tracker/head changes require independent recheck.
- **Acceptance unchanged:** This improves the **probe's** safety, not the live database's RLS proof. No real authenticated two-tenant staging test or real provider operation has run. H01–H13 remain unverified; `releaseAuthorized=false`. PRs #12–#15 stay draft and unmerged, with no deployment or customer contact.

### H01 synthetic proposal-revision isolation probe — 2026-10-22

- **Code:** Continuing [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) and existing draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), the opt-in `ci/item6_rls_readonly_probe.py` expands from **16 to 23** guarded read-only GET checks. Two additional environment-provided UUIDs must identify exactly one invented `bm_brief_revisions` row per independently authenticated synthetic tenant. After positive Auth/organization/membership controls, each user must see their own exact revision (only `id,organization_id` returned), **not** the other user's revision, and no cross-tenant revisions in unfiltered enumeration; the anonymous request must see none. No proposal body, pricing content, secret or recipient is fetched or printed.
- **Offline regression:** Four new adversarial groups in `tests/test_item6_rls_readonly_probe.py` verify foreign revision leaks, unfiltered enumeration leaks, missing own positive control and anonymous revision leaks. Linux fast on code+test commit `9f68d33748905e981e68cc8b7e72deb89f56abe5` ran **281/281 Python tests passing**. Intermediate code-only SHA `febd5ea` showed red test jobs before the updated test fixtures were committed; this is fixed by the newer code+test head, not a weakened gate. Later documentation and tracker commits require exact-head CI.
- **Operator preconditions:** The authorized staging operator must first seed **two synthetic organizations, two real independent Auth test users and one fictional brief revision per tenant**, then supply protected JWTs, the publishable API key, org IDs and revision IDs as detailed in [the H01 probe runbook](ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md). No such live two-user execution was performed. The connected database was previously found empty; do not conflate mock tests or catalog reads with H01 acceptance.
- **Hard gate:** All H01–H13 remain **unverified**. H01 still requires deny-by-role INSERT/UPDATE/DELETE, missing/revoked membership and sessions, independent verification and complete sensitive-table coverage. H02 Storage plus H03–H13 approvals, provider, durable send, buyer access and privacy/security/legal/operations reviews remain untouched. `releaseAuthorized=false`; no production SQL, customer sends, merge or deployment.

### H01 anonymous privileges and PostgREST deny semantics — 2026-10-22

- **Confirmed with read-only connected SQL:** `bm_organizations`, `bm_memberships` and `bm_brief_revisions` have `SELECT` grants to `authenticated` and no direct `SELECT` grants to `anon`. All three remain empty. `bm_brief_revisions.id` and `organization_id` are valid UUID columns. Scoped existing SELECT policies refer to membership and `auth.uid()`; this **does not constitute tested two-user isolation**. See [environment inventory](ITEM6_CONNECTED_ENVIRONMENT_INVENTORY.md).
- **Fix:** The 23-case H01 opt-in probe previously required anonymous reads to return `200 []`, so a secure no-grant Supabase anonymous response `401/403` would be a false failure. The three **anonymous-only** checks now accept `200 []` **or** `401/403` with no parsed result from the response handler, *after both genuine user sessions and all positive/cross-tenant controls pass*. Signed-in tenant checks **still require** HTTP 200 with precise expected rows. Redirects, 400/500, unexpected rows and wrong-user responses remain blocked.
- **CI:** Added three focused test groups across anonymous 401/403 for all three tables, server errors and leak cases, and rejecting authenticated 401/403. On code+test SHA `6ae05cb5200505c92ce82bbca322a8d6ba903202`, Linux fast logged **284/284 Python tests passing**; current documentation commits require a new exact-head Actions check. No gates skipped, weakened or reclassified.
- **Acceptance:** All H01–H13 **still unverified**, no live Auth tokens were used, no synthetic tenant seeding, private storage testing, customer sending, schema migration, deployment or merge. `releaseAuthorized=false`; draft PR #15 remains blocked. This fixes a **test-harness false-negative**, not a demonstrated live data exposure or independent approval.

### H01 foreign-organization enumeration negative tests — 2026-10-22

- **Existing work:** Item 6 Issue [#7](https://github.com/mlookhere/Bidmason/issues/7), draft PR [#15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`.
- **Security coverage:** The opt-in read-only H01 probe now has **27** expected checks. For each authenticated synthetic user, after matching known other-tenant membership/revision IDs, it separately queries **all records scoped to the other organization's UUID** in `bm_memberships` and `bm_brief_revisions`, requiring an empty array. This catches exposures of other rows not named in the seeded fixture. Existing own-tenant positive, anonymous deny/empty, bounded HTTPS GET and non-authorizing release holds remain unchanged.
- **Regression:** Added two negative fixture test groups for foreign-organization membership and brief revision enumeration. An earlier mock's unfiltered-list leak triggered during a new foreign-organization-filtered request; CI at [`8fcc4a3`](https://github.com/mlookhere/Bidmason/commit/8fcc4a3f0993619359d3ead4ddd515577e374c24) correctly went **red**, with an assertion expecting failure at the unfiltered step. Repaired the mock so the two leak conditions are independently exercised at `6772cedd917c9e6e3196255fd2f365ff23fc5142`. **Only CI on the final exact head counts.** Do not claim test completion until the corresponding Actions checks report success.
- **Release hold:** No real authenticated two-tenant test, external H01–H13 evidence or human approvals. No customer data, provider calls, proposal send, database write, production deployment or merge. `releaseAuthorized=false`, H01–H13 unverified, and PRs #12–#15 remain draft.

### Item 6 H02 opt-in private Storage GET probe — 2026-10-22

- **Continuation:** Existing [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Exact source commits for the new H02 probe/tests are recorded in PR history; no duplicate PR or release authorization.
- **Implementation:** Added `ci/item6_storage_readonly_probe.py`, strictly opt-in via `--live-readonly`. It requires two genuine different Supabase Auth user JWTs, a publishable key and **two pre-existing canonical synthetic object paths from distinct organization UUID prefixes**. Before accessing objects it verifies both users with `GET /auth/v1/user`. It then checks each user's own/other private `bm-evidence` object and anonymous access in **six bounded GETs with `Range: bytes=0-0`**. Own must be `206` with a valid `Content-Range` and exactly one response byte; foreign/anonymous must deny with 401/403/404. No redirects/proxies, no uploads, no signed links, no full downloads, no file/body/token/ID in results. The result always sets `h02Accepted:false`, `releaseAuthorized:false`.
- **Offline coverage:** New independent `tests/test_item6_storage_readonly_probe.py` covers both signed-in positive controls, cross-tenant/anonymous leak denial, wrong origin/service key/path prefixes/credentials, provider failures, omitted `Range` support, body-bounded GET, default no-network and output redaction. `docs/ITEM6_H02_STORAGE_READONLY_PROBE.md` details protected staging inputs, strict policy/role preconditions and operator execution. This is a **narrow diagnostic**, not a comprehensive H02 test.
- **Acceptance:** Read-only connected project policy inspection confirmed `bm-evidence` is private with tenant/membership/receipt-scoped policies, but the bucket previously had zero objects. **No real synthetic object was created or accessed, no real JWT used, and no H02 live check run occurred.** Separately validate signed URL expiry and provider-specific revocation (do not assume Auth logout revokes a signed URL), uploads/upserts/deletes, malicious paths, size/MIME boundaries, independent security/privacy review, plus all H01 and H03–H13 gates.
- **Release and CI:** H01–H13 remain **unverified**, `releaseAuthorized=false`; source PRs #12–#15 stay draft/unmerged, no live send/deployment or database mutation. Latest-head CI is required; do **not** represent queued or missing checks as successful.

### H02 unsigned public-route exposure protection — 2026-10-22

- **Scope:** Continue existing Item 6 [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) and draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15) on `work/7-delivery-preflight` → `dev`, without changing any live project setting.
- **Issue:** The previous read-only H02 probe tested private object reads on `/storage/v1/object/authenticated/bm-evidence/<path>` but not `/storage/v1/object/public/bm-evidence/<path>`. The latter could expose objects if an otherwise-private bucket were accidentally made public, even when the anonymous authenticated-route check continued to deny.
- **Implementation:** Added **two unsigned public-route GET checks**, one per pre-existing synthetic tenant object, to `ci/item6_storage_readonly_probe.py`. All object requests remain read-only `Range: bytes=0-0`, no redirects/proxies and no object/body/URL/credential logging. The two new checks require HTTP 401/403/404 with no byte access; HTTP 200, 206, 302, 400, 500, or a disclosed byte blocks. Total H02 matrix: **10 checks** (two Auth positive controls, four own/foreign checks, two anonymous private-route negative checks, two public-route negative checks). Always `h02Accepted=false`, `releaseAuthorized=false`.
- **Offline adversarial tests:** `tests/test_item6_storage_readonly_probe.py` adds two new cases: a fictional leaked public object despite valid authenticated-route denials, and several unauthorized public-route responses. Existing private/foreign negative and own-object positive tests remain. Runbook `docs/ITEM6_H02_STORAGE_READONLY_PROBE.md` and external acceptance instructions now describe all ten checks.
- **Release:** This is testing for *potential accidental exposure*, not evidence that a current exposure exists. Live bucket inspection previously found it private, with zero objects; no real JWTs or objects used. H01–H13 remain unverified; independent Storage operations, signed-link expiry/revocation, malicious upload and human review still block release. No customer sending, deployment, merge or migration.

### H02 keyless vs publishable-key public object access — 2026-10-22

- **Issue/PR:** Continue [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`; no new work branches or merged PRs.
- **Gap closed in the diagnostic:** The previous two `/storage/v1/object/public/bm-evidence/<synthetic-path>` negative GETs included the public `apikey`. A truly keyless browser download and an anonymous client with a publishable key are **distinct** access paths; testing only the latter could miss an unexpected policy/gateway discrepancy. The probe now checks **both** paths for each of two already-existing synthetic tenant objects (four public-route negatives). Public-route requests send no Auth bearer; keyless sends **no apikey**; publishable-key sends only `apikey`. All use bounded `Range: bytes=0-0` and require HTTP 401/403/404 without object bytes. HTTP 200/206, redirects, server errors and leaked bytes remain blocking.
- **Implementation:** `ci/item6_storage_readonly_probe.py` now demands **12 total** controls: two real Auth checks, four signed-in own/foreign range reads, two anonymous authenticated-route negatives, and four public-route negatives. It still refuses network without `--live-readonly`, prohibits privileged keys and full file downloads, and always returns `h02Accepted=false`, `releaseAuthorized=false`. Added two adversarial fixture tests in `tests/test_item6_storage_readonly_probe.py` for publishable-key-only public exposure and ensuring all four public calls use the intended distinct headers/paths. Runbook and external acceptance checklist updated.
- **Acceptance:** No actual live synthetic tenant/object reads, signed URL test, storage writes, provider send, deployment or merge. All H01–H13 remain unverified; H02 still needs independent live positive/negative testing, signed-link expiry/revocation, MIME/size limits, malicious paths and role-change behavior. New **exact-head** CI must independently complete all eight checks; historical passes do not count.

### H02 authenticated tenant-to-object membership binding — 2026-10-22

- **Existing scope:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) / draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15) on `work/7-delivery-preflight`, targeting `dev`. Do not merge with pending/failed exact-head CI or unverified H01–H13.
- **Gap:** The opt-in H02 private-object byte-range positive control previously proved a token can read the caller-supplied "own" object, but it did **not** independently bind the Auth user's identity to the tenant UUID prefix in that object's path. An arbitrary pair of valid user JWTs and self-selected object labels could supply misleading attribution.
- **Change:** Added **four authenticated REST read checks** to `ci/item6_storage_readonly_probe.py`, after both `GET /auth/v1/user` checks **and before any Storage object request**. For each user, verify the exact own `bm_memberships` `organization_id,user_id` row matching the object path tenant UUID, then require a foreign-organization-wide `bm_memberships` query to return `200 []` (no user-ID filter that might miss leaked other users). This raises the H02 diagnostic from 12 to **16** checks without performing writes or fetching proposal data.
- **Offline tests:** Added three negative regression groups for missing own membership, leaked foreign-org membership and permission/server errors, with the standalone fake Supabase REST transport updated. Existing keyless/publishable public Storage denials, bounded one-byte Range, no-redirect/no-proxy, no network by default and non-authorizing responses remain.
- **Acceptance:** No live Auth JWTs, memberships or Storage objects were provisioned or queried. This still does **not** demonstrate real tenant isolation, Storage provider range support, signed-link lifetime/revocation, write-boundary security or human approval. `h02Accepted=false`, `releaseAuthorized=false`; H01–H13 remain **unverified**. Retain all eight required Actions checks for the exact reviewed head and keep PR #15 draft.

### Item 6 synthetic event-backed CRM pipeline rollup — 2026-10-22

- **Durable work:** Existing [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) / draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. This is substantive Item 6 CRM-lite development, **not** a production data integration or a new issue/branch/PR.
- **Implementation:** Added `lib/synthetic-crm-pipeline.ts`: pure, redacted and non-contacting `summarizeSyntheticCrmPipeline` built on the **existing** recipient-aware review summary and delivery/deal projectors. Requires a complete explicit per-case terminal outcome matrix; aggregates delivery stages per fictional case and won/lost/unverified statuses per **unique proposal** (no double-counting a proposal with multiple recipients/revisions). Copies redacted stop-contact/operator-review/deferred totals only after the global validator rejects cross-tenant evidence, immutable revision conflicts, event replay collisions, contradictory terminal outcomes and stop-contact chronology. Empty terminal events are **unverified**, never known-open or contact-approved. Always `contactAuthorized=false`, `dataComplete=false`.
- **Adversarial tests:** New `tests-web/synthetic-crm-pipeline.test.mjs` exercises multi-case/recipient aggregation, exact-tenant scoping, missing outcomes, hostile accessor-backed/sparse/decorated matrices, conflicting outcomes, replayed IDs, aligned history, immutable revision claims and closure across revisions. `docs/ITEM6_SYNTHETIC_CRM_PIPELINE.md` explains scope and limitations. No runtime API route, send action, DB write, provider adapter or sensitive identifier output was added.
- **Verification hold:** The code-and-test head is `02fe7988ceae906dcbc718dfcdc43dc0ac667a11`, and its Actions run [#39797702134](https://github.com/mlookhere/Bidmason/actions/runs/39797702134) was queued at inspection. A later document/tracker commit requires fresh **exact-head** CI, including web-build, TypeScript, browser, native Windows and all other eight non-skipped checks; do not infer results from earlier green runs. No CI gate has been weakened or removed.
- **External acceptance unchanged:** No authenticated production CRM, complete durable provider event replay, user consent or buyer response; H01–H13 independently **unverified**, `releaseAuthorized=false`, no real customer send, deployment or merge. PRs #12–#15 remain draft.

### Item 6 static fictional CRM funnel in the delivery safety lab — 2026-10-22

- **Existing work:** [Item 6 Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. All predecessor PRs #12–#14 remain draft/unmerged.
- **Source:** `lib/delivery-lab-fixtures.ts` now derives each fictional company's **redacted** synthetic CRM pipeline from the existing exact tenant-scoped fixture records, reusing `summarizeSyntheticCrmPipeline` and the same validated event/deal/history streams as review counts. The static `app/delivery-lab/page.tsx` exposes clearly labeled per-case reported-delivered/bounced counts and per-proposal won/lost/unverified counts without recipients, tenant IDs, links, input controls, authorization tokens or live data. `app/globals.css` adds minimal caption hierarchy.
- **Regression:** `tests-web/delivery-lab.test.mjs` checks distinct fictional painting/cleaning delivery and deal totals, reconciliation of attention counts and category sums, guaranteed `contactAuthorized=false`/`dataComplete=false`, source identifier redaction and no interactive submission path. `docs/ITEM6_SYNTHETIC_CRM_PIPELINE.md` documents offline-only boundaries.
- **CI / operational limits:** Previous head `25a934351ba306efdf24dd6857daa17b2535349a` passed **all 8/8** required exact-head GitHub checks on [Actions #39798464269](https://github.com/mlookhere/Bidmason/actions/runs/39798464269), including 304 Python tests; those passes do **not** validate these new integration edits. New exact-head CI must complete independently on every required job. No live Supabase session, production CRM, provider, sending, approval or storage write; H01–H13 remain **unverified**, `releaseAuthorized=false`, no merge or deployment.

### Item 6 CRM preview integration CI root-cause repair — 2026-10-22

- **Work item:** Existing [#7](https://github.com/mlookhere/Bidmason/issues/7) / [draft PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. No new issue/branch/PR, merges, production sending or release authorization.
- **Regression 1 — transitive publish guard:** Integration of the pure `lib/synthetic-crm-pipeline.ts` into public fictional `lib/delivery-lab-fixtures.ts` made exact allowlisted public-preview imports change. Intermediate [Actions #39799133493](https://github.com/mlookhere/Bidmason/actions/runs/39799133493) correctly reported red `pr` and `win-fast` because the guard rejected the **unreviewed new import**, not because live data was exposed. Reviewed the module's offline import graph, consolidated its duplicate type/value imports, and explicitly pinned **only** its reviewed imports in `ci/publish_guard.py`. Added a new strict test in `tests/test_publish_guard.py` that injects network calls, environment reads, side effects, reexports and missing modules. Intermediate SHA `39e30f26ae45f88f89335d80fd7b541807535063` then correctly went red because this new test wrote literal `\\n` characters rather than actual newlines, preventing import regex recognition; corrected test fixture construction at `c3a26277aba84dee11f4072310768615ce2929f4`. The import/network guard remains fail-closed for all other modules.
- **Regression 2 — preserved visible safety disclaimer:** Intermediate [Actions #39799603603](https://github.com/mlookhere/Bidmason/actions/runs/39799603603) reported a red `web-build` because the lab caption had replaced the exact independently tested `No contact authorization or live tenant access` text. Restored the original exact phrase while retaining the new `Incomplete fictional evidence` disclosure, and aligned the additional UI test in commits `432980bee89e38af3e64eef54cae3475437c78c3` and `5489e57038a8f0e904fc24ab23fffb91a1772760`. No existing safety assertion or release gate was deleted or weakened.
- **Current CI:** The previous baseline `25a934351ba306efdf24dd6857daa17b2535349a` was independently **8/8 successful** on [#39798464269](https://github.com/mlookhere/Bidmason/actions/runs/39798464269), but that is **not** verification for this UI integration. Exact-head checks must be re-read and remain pending until all eight SHA-matched jobs complete successfully. External H01–H13 acceptance and human reviewer approvals remain **unverified**, `releaseAuthorized=false`; all predecessor PRs #12–#14 and PR #15 remain draft/unmerged.

### Item 6 offline buyer-portal view and nonbinding reply review — 2026-10-22

- **Durable scope:** Continue [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) / draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Predecessor PRs #12–#14 remain draft/unmerged. This is **not** a production buyer portal.
- **Implementation:** Added `lib/synthetic-buyer-portal-review.ts`, a pure redacted adapter that composes the existing signed `buyer-view-grant` verifier with the nonbinding `buyer-response-draft` assessor. A valid, scoped, unexpired grant may produce **signed-claims-only**; fictional `question`, `request_changes` and `decline` can produce **draft-internal-only**. Wrong tenant/proposal/revision/recipient/content, expired/future/revoked/forged grants, previously responded grant IDs, disallowed approval/submit kinds, invalid note content and malformed response-history matrices block or throw. Even a valid grant cannot read a PDF or submit a buyer response: **`contentAccessible=false`, `responseSubmitted=false`, `contactAuthorized=false`, `dataComplete=false`**. Returned reports omit recipient, tenant, proposal IDs, JWT/token, grant ID, response text and draft fingerprint.
- **Test evidence:** Added `tests-web/synthetic-buyer-portal-review.test.mjs` with signed-claims-only, nonbinding question/decline/change drafts, stale/revoked and wrong-identity grant denials, draft replay, unsafe notes/approval attempt rejection, malicious response-history containers and redacted output regression cases. The source is **not reachable from a public page or a new server route**; the existing `lib/synthetic-*` runtime-boundary guard continues to reject importing it in a live request path. `docs/ITEM6_SYNTHETIC_BUYER_PORTAL_REVIEW.md` records conditions and limitations.
- **Prior milestone:** The existing CRM lab integration head `11b99afb32a3880bd73cc66b0a96aad310d4e45e` is independently green **8/8** in [Actions #39800493678](https://github.com/mlookhere/Bidmason/actions/runs/39800493678) (305 Python tests); those green checks cannot validate these new buyer-portal changes. The test-bearing buyer-portal source head is `80522b0cc072e7cd794599f5a8cf7138d846445f`; a documentation/tracker commit requires its **own exact-head** CI.
- **Release unchanged:** H10 live buyer authentication, active tenant membership, CSRF, exact approved current revision, durable grant revocation and response persistence, PDF access and independent reviewer signoff have **not** occurred. H01–H13 remain **unverified**; `releaseAuthorized=false`. No real buyer access, sending, provider call, deployment, DB mutation or merge.

### Item 6 buyer portal replay-history transparency — 2026-10-22

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. No duplicate issue, branch or PR; predecessors #12–#14 remain draft/unmerged.
- **Defect:** The synthetic buyer portal review could return `response:"not-requested"` when the current, cryptographically verified read-only grant ID was already present in the **caller-supplied** prior-response array but the caller supplied no new draft. This concealed a replay-related review state, though no actual buyer response was submitted.
- **Fix:** `lib/synthetic-buyer-portal-review.ts` now returns a **blocked, explicitly labeled** `reason:"response-already-in-supplied-history"` in this no-draft case. The same reason accompanies a rejected second fictional draft. A different grant remains independently evaluated, and invalid or mismatched view claims still return generic `grant-not-verified` without leaking whether a grant ID appeared in the caller's history. No grant ID, token, document, note, tenant identifier or recipient appears in the result. `contentAccessible=false`, `responseSubmitted=false`, `contactAuthorized=false` and `dataComplete=false` remain invariant.
- **Tests:** `tests-web/synthetic-buyer-portal-review.test.mjs` adds negative/positive adversarial groups for no-draft replay, reuse of the same grant with a draft, a distinct grant, output redaction and invalid-view non-disclosure. `docs/ITEM6_SYNTHETIC_BUYER_PORTAL_REVIEW.md` documents the interpretation. These are **offline tests** only and do not establish durable replay prevention, live buyer identity, signed-PDF access or independent H10 acceptance.
- **CI and release:** The preexisting buyer portal review SHA `bdb1895bf08d49b0cf6d1fa57a6806f155ca85ac` had **3/8 SHA-matched checks successful and 5 pending** at initial inspection. The new test-bearing code SHA `8c7e71532e696554a4ab92c4a88942d047bab195` has reported fast/PR/PDF/webhook success with the remaining jobs pending; **later docs/tracker heads require their own 8/8 completed-success checks**. All H01–H13 external acceptance remains **unverified**, `releaseAuthorized=false`. No authenticated production portal, customer message, Supabase write, deployment or merge.

### Item 6 fictional inbound buyer-response inbox — 2026-10-22

- **Durable work:** Continue existing [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`; predecessors #12–#14 remain unmerged. This adds substantive non-sending Item 6 CRM/portal triage without a new issue or production route.
- **Implementation:** Added pure `lib/synthetic-buyer-inbox.ts`. Requires a dense, exact-schema, ordered array of 1–100 fictional inbound events; validates each event's UUID uniqueness, nonfuture/nondecreasing integer observation time, strict nonbinding draft, current tenant/proposal/revision/recipient/content identity, scoped signed read-only grant and caller-provided revoked grant list via the **existing** `assessBuyerResponseDraft` verifier. Previously seen grant IDs cannot contribute a second event; any mismatch/replay throws and **prevents partial counts**. Reports only invented question/change-request/decline totals and number requiring operator review, always `state:"inbox-simulation-only"`, `responseSubmitted=false`, `contactAuthorized=false`, `dataComplete=false`. No response text, token, grant, tenant or recipient escapes the projector.
- **Adversarial offline tests:** Added `tests-web/synthetic-buyer-inbox.test.mjs` with groups for distinct signed drafts, nonbinding declines, duplicate event IDs/grants, chronology and invalid times, expired/revoked/bad-signature/wrong-tenant or revision claims, unsafe/approval-like drafts, hostile accessor/sparse/decorated inputs, wrong identity and privacy-safe no-contact output. `docs/ITEM6_SYNTHETIC_BUYER_INBOX.md` defines the evidence contract and why caller-supplied timestamps/identity are **not** authenticated production events. The `lib/synthetic-*` runtime boundary still disallows live server imports.
- **Red CI diagnosis/fix:** Intermediate [Actions #39804091161](https://github.com/mlookhere/Bidmason/actions/runs/39804091161) had a red `web-build` because the new test mistakenly included a **valid, unrevoked** synthetic grant in cases expected to fail. Removed that false expectation, retaining an explicit negative test with the **actual verified revoked grant ID**, at commit `74cef8e3b75d6d670f751dc18f6d53c9970e7b16`. No guard, validator, CI check or release acceptance requirement was weakened. The test-bearing corrected [Actions #39804377862](https://github.com/mlookhere/Bidmason/actions/runs/39804377862) reports **fast, PR, security, PDF QA, web build and synthetic-webhook QA successful**, browser E2E and Windows pending at inspection. Later docs/tracker commits require **independent exact-head CI**.
- **External acceptance:** No real buyer Auth, live provider event, durable append-only inbox, signed PDF read, transactional uniqueness, customer message, CRM update, DB write or deployment. All **H01–H13 unverified**, `releaseAuthorized=false`; PR #15 draft/unmerged.

### Item 6 company-scoped fictional buyer inbox — cross-stream deduplication (2026-10-22)

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), branch `work/7-delivery-preflight` → `dev`. Predecessor PRs #12–#14 remain draft/unmerged. The previous inbox head `a260153891e90115ca328ff308cb5e18108a233c` **completed all 8 required CI jobs successfully** on [Actions #39804615274](https://github.com/mlookhere/Bidmason/actions/runs/39804615274); this green result is historical, not a new-head approval.
- **Gap fixed:** The existing `summarizeSyntheticBuyerInbox` rejects duplicated event UUIDs and reused signed grant IDs **inside one fictional stream**, but independent streams could previously report the **same event or grant again** if an operator added the per-stream counts. Added `summarizeSyntheticBuyerInboxBatch` in `lib/synthetic-buyer-inbox.ts` to require 1–20 exact-schema dense streams and a total cap of 500 events for a single explicit synthetic organization. It invokes the original per-stream validator **without weakening it**, then independently rejects event ID or signed grant ID collision **across every stream**. It counts fictional questions, change requests, declines and operator-review cases; adds only redacted `streamsReviewed` and per-unique-proposal `distinctProposals`, without leaking any tenant/recipient/proposal/grant/token/note identifiers. Any bad event blocks the **whole result**. The results still always say `responseSubmitted=false`, `contactAuthorized=false`, `dataComplete=false`.
- **QA:** Added `tests-web/synthetic-buyer-inbox-batch.test.mjs` with seven positive/adversarial groups covering per-company multiple-proposal rollup, same-proposal deduplication, cross-stream duplicate event IDs and grant IDs, wrong-tenant or wrong-proposal claims, revoked/forged grant, missing/decorated/sparse/accessor-backed inputs, wrong identity, invalid times and forbidden response content. Updated `docs/ITEM6_SYNTHETIC_BUYER_INBOX.md` with batch schema and remaining security limitations.
- **CI evidence:** Test-bearing head [`5a54ea7`](https://github.com/mlookhere/Bidmason/commit/5a54ea7c9a1d74421bc29df6d182caaa207b8ba7) passed fast, PR, security, PDF QA, synthetic webhook QA and **web-build including 280/280 Node tests**, as observed on [Actions #39805494676](https://github.com/mlookhere/Bidmason/actions/runs/39805494676); browser E2E and Windows fast were still pending at inspection. Later documentation/tracker commits require their own completed exact-head results. Never represent pending or earlier green checks as final.
- **Acceptance:** These events and timestamps are caller-supplied fiction, not a real authenticated buyer inbox, provider-verified webhook, durable transactionally unique message ledger, or complete CRM history. H01–H13 external acceptance and H10 authenticated buyer view/response remain **unverified**. `releaseAuthorized=false`. No production database/storage changes, customer contact, approved PDF view, deployment or merge; PR #15 stays draft.

### Item 6 H01 anonymous denial-body truthfulness (2026-10-22)

- **Existing durable work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` -> `dev`. Predecessor PRs #12-#14 remain draft/unmerged.
- **Observed failure mode and repair:** `ci/item6_rls_readonly_probe.py` previously mapped any HTTP 401/403 `HTTPError` to `(status, None)` **without inspecting its response body**. This could falsely mark anonymous isolation checks as clean even if an error body exposed tenant records. Commit [`49a5dc2`](https://github.com/mlookhere/Bidmason/commit/49a5dc297ff415984edcea5f41dcdff0aad53c88) now peeks only one denied-response byte, never logs provider bodies, and returns an opaque nonempty indicator so error responses with a body cannot pass as an empty denial. Even a normal JSON error envelope remains unverified and blocks this narrow diagnostic.
- **Regression/documentation:** Commit [`062e689`](https://github.com/mlookhere/Bidmason/commit/062e68981d7536f64f0467285ed87817ceb4d41b) adds offline HTTP 401/403 transport tests for empty denial, ordinary JSON error, leaked synthetic row, and oversized body, including no-leak assertions. [`657d652`](https://github.com/mlookhere/Bidmason/commit/657d652fd348f87cd06ef196cc7fb69c341ba74d) clarifies `docs/ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md`. **CI for the final tracker-bearing head must be checked independently; tests are not claimed passed here.**
- **Release status unchanged:** No authorized two-user live session, cross-tenant write/revocation evidence, validated storage isolation, owner-approved policy, signed provider webhook, transactional dispatch, actual buyer inbox, or independent H01-H13 acceptance. All remain unverified; `releaseAuthorized=false`, no production/customer actions or merge.

### Item 6 H01/H02 denied-response body integrity (2026-10-22)

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` to `dev`; preceding draft PRs #12–#14 remain unmerged.
- **Gap and fix:** H02 private Storage `ci/item6_storage_readonly_probe.py` previously returned `(401/403/404, False)` for any denied HTTP request **without reading its body**, so even a response body containing private data could be misread as proof of isolation. It now reads at most one denial byte and fails closed when that body is nonempty or missing/uninspectable. Applied the same missing-response-stream guard to H01 read-only PostgREST `ci/item6_rls_readonly_probe.py`. Neither probe records raw response content or any credential. Legitimate nonempty provider JSON errors also remain unverified (rather than receiving false-positive clearance).
- **Regression evidence:** `tests/test_item6_storage_readonly_probe.py` now exercises denied 401/403/404 empty, ordinary provider JSON, synthetic leaked private data, redirect and missing streams plus the full H02 negative-isolation verdict. `tests/test_item6_rls_readonly_probe.py` verifies that a missing H01 denial stream cannot count as empty. Updated `docs/ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md` and `docs/ITEM6_H02_STORAGE_READONLY_PROBE.md` with the conservative diagnostic contract. **Exact-head CI must be inspected independently; these are source changes, not claims of passing tests.**
- **No release or customer authority:** H01/H02 real two-user signed-in testing and negative writes, storage revocation, approved price/revision, live provider credentials/signatures, durable dispatch, authenticated buyer response, independent H03–H13 reviewer evidence and human go/no-go are not satisfied; `releaseAuthorized=false`. No live database write, real customer request, customer send or merge.

### Item 6 H01/H02 HTTPError fixture causal repair (2026-10-22)

- **Exact failed CI:** [Actions #39807842658](https://github.com/mlookhere/Bidmason/actions/runs/39807842658) on head `09165c32` returned failing `fast`, `pr`, and `security` jobs. The first causal failure was five offline assertions: test constructors passed `HTTPError(fp=None)` expecting an absent stream, but CPython substitutes an **empty BytesIO**, so the runtime correctly treated that fabricated HTTP response as body-empty; the tests' assumptions were wrong.
- **Repair:** [`bce62a6`](https://github.com/mlookhere/Bidmason/commit/bce62a6e8ff5b03c66e7a536dc1e5695f7d497cc) and [`c681e63`](https://github.com/mlookhere/Bidmason/commit/c681e637a42ec35e8c2ec0f036f4d8dd03754ae2) now explicitly unset `error.fp` **after** HTTPError construction to simulate a genuine unavailable body stream in both H01 and H02 negative tests. Runtime guards and all required CI checks remain unchanged. **Replacement exact-head Actions must be verified independently**; an earlier red run stays red.
- **Acceptance remains blocked:** These are tests of offline adapters, not connected Supabase two-user RLS/Storage negative evidence, actual provider/recipient approval, native signed callbacks, transactional sends, or independent H01–H13 signoff. No merge, customer contact, deployment or release authorization.

### Item 6 H02 one-byte positive control size enforcement (2026-10-22)

- **Durable state:** Existing [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` to `dev`; upstream PRs #12-#14 unmerged.
- **Problem:** H02 `GET Range: bytes=0-0` already required a valid `206` and one returned byte, but it accepted a `Content-Range` total size up to ten decimal digits without comparing it to the known private bucket object-size policy. This could misclassify a response claiming a noncompliant oversized object as a clean own-object positive control.
- **Implementation:** `ci/item6_storage_readonly_probe.py` now rejects a claimed total size greater than the **15,728,640-byte** limit recorded in [connected environment inventory](ITEM6_CONNECTED_ENVIRONMENT_INVENTORY.md). `tests/test_item6_storage_readonly_probe.py` exercises the exact upper boundary and several oversized successes/failures. [H02 runbook](ITEM6_H02_STORAGE_READONLY_PROBE.md) states this only validates the response's internal consistency against *observed metadata*, not live enforcement of bucket policy. The response remains one-byte bounded, read-only, and non-authorizing; no existing security checks were removed.
- **Evidence / hold:** Exact-head GitHub Actions check must be independently verified before marking any new verification complete. Existing H01-H13 real distinct-user tenant/Storage/auth/revocation, signed provider, durable dispatch, customer-facing permission and independent release approval remain **unverified**. `releaseAuthorized=false`; no production DDL, customer action, merge or deployment.

### Item 6 H02 MIME-consistent one-byte private Storage evidence (2026-10-22)

- **Existing active scope:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) / draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` to `dev`. PRs #12–#14 remain upstream draft/unmerged.
- **Failure mode:** The opt-in H02 Storage probe validated signed-in tenant membership, HTTP 206, strictly one returned byte, canonical range/size and foreign/anonymous denial, but did not validate the positive response's MIME and content encoding. A substituted `text/plain` or compressed response could satisfy a syntactically correct one-byte success for a `.pdf`/`.png`/`.jpg`/`.jpeg` test fixture.
- **Implementation:** `ci/item6_storage_readonly_probe.py` now binds `Content-Type` to the exact synthetic object path extension (`application/pdf`, `image/png`, `image/jpeg`), rejects missing/inconsistent types and non-identity `Content-Encoding`; retains the observed ≤15,728,640-byte upper bound, single-byte limit, proxy/redirect restrictions and all original negative checks. `tests/test_item6_storage_readonly_probe.py` includes all allowed extensions, MIME mismatches, missing type, compressed responses and boundary checks. Runbook `docs/ITEM6_H02_STORAGE_READONLY_PROBE.md` updated.
- **Evidence limitations:** This is an offline read-only consistency diagnostic, **not** live uploaded-file MIME validation, AV scanning, actual two-user private Storage RLS, signed-link lifecycle, or release approval. Latest exact-head CI must pass all required jobs independently before any code QA success is claimed. H01–H13 independent live acceptance remains unverified, `releaseAuthorized=false`; no data mutation, real file upload, customer contact or merge.

### Item 6 live-import boundary: block-comment separators (2026-10-22)

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. PRs #12–#14 remain upstream draft/unmerged; no new issue/branch/PR.
- **Identified gap:** `ci/item6_runtime_boundary.py` checked direct and transitive imports from server entrypoints but used regex separators that could miss valid JS/TS module syntax when `/* ... */` occurs between `import`/`export`, `from` and the quoted module, or between `import`/`require` and an opening parenthesis. A live API route could therefore import a synthetic-only helper without a corresponding offline-boundary violation.
- **Remediation:** Added a bounded lexical block-comment separator to the existing static import, re-export, side-effect import, `import(...)` and `require(...)` probes, with matching ending at the **first** comment close rather than spanning executable code. `tests/test_item6_runtime_boundary.py` adds four adversarial groups covering direct imports, re-exports, side effects, dynamic/require, missing local dependencies and harmless ordinary dependencies. Existing unresolved/dynamic fail-closed gates remain unchanged. The scanner is still **not a full JavaScript/TypeScript parser** and not proof of a secure live runtime, so production architectural review remains mandatory.
- **Verification:** Exact-head GitHub Actions run must be checked independently; source updates and offline fixture assertions alone are not a passed CI verdict. H01–H13 real Auth/RLS, company policy, revision/recipient consent, provider signature, transactional delivery, buyer portal, compliance and go/no-go remain **unverified**, `releaseAuthorized=false`; no live tenant mutation, release, customer contact or merge.

### Item 6 runtime-boundary symlink containment (2026-10-22)

- **Existing work only:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) / [draft PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`; PRs #12–#14 remain unmerged and draft.
- **Gap:** The Item 6 static live-runtime import scanner already refused symlinked TS/package module **configuration** but did not refuse symlinked executable source paths. A symlinked live Next.js route, module helper, source directory or root `proxy.ts` could be scanned through different filesystem traversal/resolution behavior, including targets outside the checked tree. That is not trustworthy evidence that synthetic-only delivery/portal code is unreachable.
- **Fix:** `ci/item6_runtime_boundary.py` now fails closed on symlinked executable files and source-tree directories under `app/`, `pages/`, `lib/`, `src/`, and on symlinked root `middleware`, `instrumentation` and `proxy` runtime files. Excluded generated/dependency trees are not treated as first-party source. The scanner does not follow symlinks or ingest their destinations while constructing its findings. `tests/test_item6_runtime_boundary.py` adds portable mocked symlink regressions for a live route, apparently safe helper, directory and root proxy; ordinary non-symlinked imports remain valid.
- **Evidence:** Exact-head GitHub Actions must independently verify fast, PR, security, Windows, browser, PDF, web-build and webhook QA. This is a static guard, **not** a full language parser, real tenant authorization, actual webhook provider check or go-live clearance. H01–H13 external reviewer evidence remains **unverified**, `releaseAuthorized=false`; no customer send, live Supabase DDL, deployment or merge.

### Item 6 native Windows symlink-test cause correction (2026-10-22)

- **Red-run evidence:** Previous exact-head [Actions #39811940024](https://github.com/mlookhere/Bidmason/actions/runs/39811940024) on `cfaef83bffe1136f2122dba97ca8d3777f214a4b` finished **7/8 required checks successful and `win-fast` failed**. The native Windows job `119940243412` reported **four failures** in the newly introduced symlink-boundary tests, with `findings()` returning `[]` instead of the expected injected symlink finding. The Linux fast run had passed **318 Python tests**, so green Linux evidence did not establish Windows compatibility.
- **First-cause fix:** [`2e00350`](https://github.com/mlookhere/Bidmason/commit/2e00350aa53d92c5952a6de2a94d749403000b98) updates the four mocked `Path.is_symlink` callbacks in `tests/test_item6_runtime_boundary.py` to match stable component names instead of testing equality with a raw TemporaryDirectory absolute path. Windows path canonicalization can produce different spellings during `findings(root.resolve())`. The production scanner remains fail-closed, unchanged; no CI check or test was removed. Independently verify the replacement exact-head Windows and all other Actions jobs.
- **Unresolved external release acceptance:** H01–H13 remain unverified, predecessor draft PRs #12–#14 remain unmerged, PR #15 remains draft. No live tenant mutation, provider communication, production deployment or release authorization; `releaseAuthorized=false`.

### Item 6 same-line server directive import-boundary protection (2026-10-22)

- **Existing scope:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Predecessor draft PRs #12–#14 remain unmerged.
- **Prior verification:** Replacement [Actions #39812519271](https://github.com/mlookhere/Bidmason/actions/runs/39812519271) passed **8/8 required jobs** on exact commit `27efc4c2e2572d37a149ffa6c6fa54f3ad2a8aad`, including native Windows. This applies **only** to that old commit, not to later changes.
- **Identified gap:** `ci/item6_runtime_boundary.py` originally detected a `'use server'` directive only when the directive was the sole content of a line. A valid JavaScript directive prologue can instead be followed on the **same line** by `; export`, `; import`, or comments. A server-action module not otherwise imported by a route, or the named public preview page, could therefore evade detection and import fabricated delivery/portal code.
- **Fix:** Recognize a quoted line-start `use server` directive followed by valid comment/whitespace/semicolon or newline sequence without requiring line-end after the semicolon. `tests/test_item6_runtime_boundary.py` tests same-line import, block-comment re-export, line-comment plus ASI newline, removal of the named preview exemption, and ordinary safe imports. The existing direct/transitive import and dynamic resolution gates are not relaxed. This is still only static inspection, not authenticated server authorization.
- **Evidence hold:** Independently verify all eight jobs at the new **exact head**; missing, skipped or running jobs do not count as green. No H01–H13 real tenant Auth/RLS/private Storage, approved company policy, signed webhooks, durable dispatch, consent, buyer portal, legal/security/release approval was obtained. `releaseAuthorized=false`; no production DDL, customer sending, deployment or PR merge.

### Item 6 function-scoped server-action runtime containment (2026-10-22)

- **Existing scope:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Predecessor draft PRs #12–#14 remain unmerged.
- **Identified gap:** The earlier static safeguard recognized file-level `"use server"` directives at line start, including inline `;` forms, but missed the Next.js **function-scoped** directive when the first function-body statement appears on the same line as `{` (e.g. `async function action(){ "use server"; ... }`). An otherwise unreferenced module in `lib/` or `src/` might contain an executable server action importing caller-supplied synthetic delivery, grant or response logic without being treated as a live entrypoint.
- **Fix:** `ci/item6_runtime_boundary.py` now recognizes leading function-body `"use server"`/`'use server'` as a live server-action directive, including immediately preceding whitespace or fully closed `/* ... */` comments. Both its exact named fictional preview exemption and global source-entrypoint walk use the same detection helper. `tests/test_item6_runtime_boundary.py` adds four regressions for inline scoped action import, leading comment with `require`, loss of the preview exemption, and ordinary safe action/string content. Existing fail-closed path, symlink, alias and dynamic import gates are unchanged.
- **Evidence hold:** The previously verified SHA and green Actions results apply only to that earlier commit; separately verify **all eight** required checks at the new exact head. The static guard is conservative and **not** a JavaScript parser, trusted runtime authentication, verified send/provider check or human acceptance. H01–H13 live external evidence remains unverified; `releaseAuthorized=false`, with no customer send, live DDL, deployment or merge.

### Item 6 SQLite rehearsal identity check inside reserved transaction (2026-10-22)

- **Existing durable work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Upstream draft PRs #12–#14 remain unmerged.
- **Observed correctness risk:** `ci/item6_sqlite_rehearsal.py` checked the synthetic fixture marker before `BEGIN IMMEDIATE`, outside the lock that serializes invented consent/review/contact/reservation work. A second writer could alter the marker after validation but before the rehearsal transaction began, creating a time-of-check/time-of-use gap in the fixture identity safety policy.
- **Change:** Move the `rehearsal_fixture_identity` marker read and exact one-row comparison into the **same `BEGIN IMMEDIATE` transaction** as the supplied work. Invalid/missing marker errors now execute explicit `ROLLBACK` and release the lock; no schema checks were weakened. `tests/test_item6_sqlite_fixture_identity.py` now observes that the marker is read only while `sqlite3.Connection.in_transaction` is true and independently verifies that a rejected marker leaves no invented reservation and no stranded writer lock. This is SQLite-only, disposable, credential-free and **not** authorization to send or proof of live PostgreSQL isolation.
- **CI evidence:** Validate all eight required GitHub Actions jobs at the **exact latest head** independently. Old green commits do not establish this change passed. All H01–H13 real independent external acceptance remains unverified, `releaseAuthorized=false`; no customer send, live schema alteration, production deployment, new issue/PR or merge.

### Item 6 exact-head CI backlog: superseded workflow cancellation (2026-10-22)

- **Existing durable work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. The three predecessor PRs #12–#14 remain draft/unmerged.
- **Observed GitHub evidence:** The prior exact-head [Actions #39814718850](https://github.com/mlookhere/Bidmason/actions/runs/39814718850) on `9a2b60c6c7ee2146bf645288b12c658f36019622` had **8/8 required check records, all queued**, while earlier commits' runs `39814659513`, `39814571768` were also queued and an even earlier `39814033598` remained in progress. No queued result is proof of passing CI; this is a runner backlog, not a completed failure.
- **Implementation:** `.github/workflows/ci-pr.yml` now declares `concurrency.group` partitioned by `github.workflow` and PR number (or branch ref on push) and `cancel-in-progress: true`. Only superseded runs within the **same PR/branch workflow group** may be cancelled; it never cancels checks from another PR, never excludes a check on the latest SHA, and preserves the entire existing eight-job matrix and permissions. Older runs created **before** the new concurrency declaration may not share this group; do not assume they were cancelled automatically. Cancelled/stale/missing/skipped/queued checks are never success.
- **Review gate:** Independently inspect all eight named checks and the workflow run for the new exact head before any green status claim. This is operational CI resource management, not proof of production delivery; all H01–H13 externally authenticated acceptance remains unverified, `releaseAuthorized=false`. No merge, live database mutation, sending, customer contact, or release.

### Item 6 synthetic webhook event-time freshness bound (2026-10-22)

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) / draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Predecessor PRs #12–#14 remain draft/unmerged.
- **Identified safety gap:** `lib/synthetic-webhook-verification.ts` separately allowed signed header time within 300 seconds of the received-at time **and** event `observedAt` within 300 seconds of the header time. Together these independent windows could mark an observed event **600 seconds** before/after receipt as `fixture-verified-only`, even though neither individual limit was violated. That weakens evidence freshness and could disguise backdated or prematurely future callbacks in the fictional receipt simulator.
- **Fix:** Continue requiring exact canonical UTC, header–receipt freshness, event–header consistency and HMAC authentication, **also require event observation to be within 300 seconds of receipt directly**. `tests-web/synthetic-webhook-verification.test.mjs` adds adversarial ±600-second chained-window cases, accepts ±300-second direct boundary, and blocks ±301-second direct violations. The result remains explicitly `fixture-verified-only`, not provider authentication or delivery permission.
- **Evidence and operational hold:** Previous GitHub [run #39815692150](https://github.com/mlookhere/Bidmason/actions/runs/39815692150) was queued on prior SHA `ba1f423f074f8c9cd89625f3f28a7f33743162c7`. Its result cannot greenlight this change. Verify **all eight** required checks against the newest head and do not count queued, cancelled, skipped or missing jobs as passed. Independent H01–H13 live tenant Auth/RLS, company approvals, consent, provider-native signatures, durable webhook/send, buyer identity, privacy/legal/security/ops and human release approval remain unverified; `releaseAuthorized=false`. No live writes, external sends, deployment or merge.

### Item 6 signed webhook subsecond event chronology (2026-10-22)

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`; upstream draft PRs #12–#14 remain unmerged.
- **Prior validated checkpoint:** [Actions #39816507616](https://github.com/mlookhere/Bidmason/actions/runs/39816507616) completed **8/8 required checks successfully** on historical exact SHA `77b302212cb727fd26812252f988d486136c8fbc`. Prior green results do not verify subsequent commits.
- **Concrete gap:** The fictional raw-byte HMAC validator used `Math.floor(Date.parse(observedAt) / 1000)` when applying each 300-second freshness window. An observed event **300.001–300.999 seconds** from its receipt or signature timestamp could therefore be admitted as within a 300-second bound. This was distinct from the previously corrected compound five-plus-five-minute drift.
- **Fix:** `lib/synthetic-webhook-verification.ts` now compares **integer millisecond timestamps directly** against both signature and receipt times, preserving the existing HMAC, 300-second limits, strict event schema, scope and replay checks. `tests-web/synthetic-webhook-verification.test.mjs` adds ±300.000-second passing boundaries and ±300.001/±300.999-second failures, including an isolated event/header one-millisecond violation with event/receipt only one millisecond apart. This is still fabricated, non-sending offline validation and not real provider authentication.
- **Review hold:** Require 8/8 successful non-skipped required checks on the **latest exact SHA**. H01–H13 independent real Auth/RLS/Storage, business-owner revision/recipient consent, native provider verification, durable dispatcher, buyer portal, legal/privacy/security/operations and human go/no-go remain **unverified**; `releaseAuthorized=false`. No production DDL, customer send, deployment, merge or approval.

### Item 6 cross-proposal reservation after recipient contact-stop (2026-10-22)

- **Existing work:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7), draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15), `work/7-delivery-preflight` → `dev`. Prerequisite draft PRs #12–#14 remain unmerged. No new issue, branch or PR.
- **Confirmed review-model inconsistency:** `lib/delivery-review-summary.ts` combines stop-contact evidence from all fictional proposals and historical streams for the same tenant/recipient, and previously rejected a **follow-up attempt** after the earliest such stop. However, a distinct proposal's newly `reserved` delivery at or after that stop was silently categorized as suppressed rather than marked contradictory. An aggregate could therefore appear internally reconciled despite a dispatch reservation known to postdate an opt-out, complaint, bounce or reply.
- **Fix:** After validating every stream, compare each current entry's first `reserved` observation to the earliest tenant-and-recipient stop across all current and supplied historical streams. A reserved timestamp **greater than or equal to** the stop timestamp now fails the entire aggregate with `Cross-proposal simulated reservation conflicts with contact-stop chronology`. It preserves strictly earlier reservations as auditable prior work, retains precedence of suppression and replies, and does not impose a false business cooldown across unrelated recipients.
- **Tests:** `tests-web/delivery-review-summary.test.mjs` adds adversarial same-instant and 1ms-later reservations for each of reply/opt-out/bounce/complaint, in either stream order; a 1ms-earlier valid reservation; separate-recipient control; and historical stop across earlier proposal streams. All are invented and non-sending. This is deterministic source-level coherence only, not authenticated live consent, a database CAS or an outbound provider.
- **Verification:** Previously [Actions #39817488051](https://github.com/mlookhere/Bidmason/actions/runs/39817488051) succeeded **8/8 required jobs** on older SHA `b813b6f29088d992b1d97ed650a752eea3e2ce4d`; new work requires its **own** exact-SHA successful run. Never count missing, queued, cancelled, skipped or previous-head results as pass. H01–H13 independently verified real acceptance remains blocked; `releaseAuthorized=false`, no live tenant writes, real contact, merge or deployment.

### Item 6 red CI cause repair: fictional delivery lab late-response chronology (2026-10-22)

- **Red-run evidence (not green):** [Actions #39818447724](https://github.com/mlookhere/Bidmason/actions/runs/39818447724) on `29add7d2c542fb6c10c5cd75d1ae9f95e5692f7a` reported **`web-build` failure**. The Node web suite passed the new direct negative tests but **2 existing `delivery-lab.test.mjs` cases failed**, and the Next production export failed to prerender `/delivery-lab`. Logs confirm `Cross-proposal simulated reservation conflicts with contact-stop chronology` from `lib/delivery-review-summary.ts`. The guard correctly identified that two **fictional public lab** previous-proposal stop events occurred before the newer proposal reservation. A successful isolated unit test did not mean all fixtures were coherent.
- **Root-cause correction:** Kept the stronger global tenant/recipient contact-stop reservation invariant intact. `lib/delivery-lab-fixtures.ts` now models earlier proposal's fabricated reservation/acceptance/delivery on **October 19**, the new proposal's fabricated reservation/delivery on **October 20**, and a **late recipient opt-out or reply on the earlier proposal on October 21**. This makes the public teaching cases internally coherent: a response to a prior proposal stops later contact **after** the current reservation, without inventing a fresh dispatch after a known stop. It keeps all seven case identities, labels, tenant scopes, redacted portal states, public no-send/noindex controls, and no actual business data.
- **Regression:** `tests-web/delivery-lab.test.mjs` now directly checks the derived cleaning stop-contact and painting manual-reply categories and verifies fictional CRM results remain incomplete and cannot authorize contact. The new cross-proposal negative cases remain enforced. All eight required exact-head CI checks must independently pass; failing, queued, missing or skipped results are not green.
- **Safety gates:** `releaseAuthorized=false`, H01–H13 independently authenticated live environment checks and signoffs unverified. Predecessor PRs #12–#14 remain draft/unmerged; PR #15 draft/unmerged. No live sends, customer writes, deployment or release.

