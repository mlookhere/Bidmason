# Item 6 — Actual four-branch integration preflight (no merge)

**Observed:** 2026-10-22 · **State:** PREPARATION ONLY / BLOCKED.  
**Scope:** [Issue #7](https://github.com/mlookhere/Bidmason/issues/7) and existing draft [PR #15](https://github.com/mlookhere/Bidmason/pull/15).  
**Method:** Read live GitHub branch heads, compare each against `dev`, inspect each branch's actual `.github/workflows/ci-pr.yml`, then recheck connected BidMason Supabase *metadata and aggregate row counts only*. No merge, deployment, database write or customer action was performed.

## Pinned GitHub heads and independently tested branches

| Slice | Existing PR | Branch SHA at inspection | Files changed against `dev` | Distinct Actions jobs in that branch | Verified current-head result |
| --- | --- | --- | ---: | ---: | --- |
| 3/8 tenancy | [#12](https://github.com/mlookhere/Bidmason/pull/12) | `d17844b6387ffe9b5970dda1350a871276b38f7a` | 111 | 9 | 9/9 success |
| 4/8 intake | [#13](https://github.com/mlookhere/Bidmason/pull/13) | `7da070f04a75bba399618244401536cfde8263e2` | 185 | 9 | 9/9 success |
| 5/8 proposal | [#14](https://github.com/mlookhere/Bidmason/pull/14) | `dd3ea62c63352dbecdda49f3f0267b57e49d3d4d` | 17 | 8 | 8/8 success |
| 6/8 delivery | [#15](https://github.com/mlookhere/Bidmason/pull/15) | `4165ac2b9b8b3b6289ea6390268e61760ab19e10` | 90 | 8 | [8/8 success](https://github.com/mlookhere/Bidmason/actions/runs/39842955102) |

The `dev` comparison base was `08e40794829b92e910af1432fd3c2bf7c8cf502e` and `main` remained `a3225039bb5415aad2e6c950e9d11c1a2842bdd2`. These file counts are *per-branch diffs*, not summed unique files or an integrated-tree validation. Changes after these pinned heads require a fresh comparison.

**Individual CI is not combined CI.** A successful feature-branch run cannot demonstrate that all migrations, module imports, workflows and required gates survive the four-way integration.

## Verified overlapping paths: resolve deliberately

| Pair | Files changed by both branches |
| --- | --- |
| #12 + #13 | `.github/workflows/ci-pr.yml`, `docs/BIDMASON_EXECUTION_TRACKER.md`, `tsconfig.json` |
| #12 + #14 | `.github/workflows/ci-pr.yml`, `docs/BIDMASON_EXECUTION_TRACKER.md` |
| #12 + #15 | `.github/workflows/ci-pr.yml`, `ci/workflow_policy.py`, `docs/BIDMASON_EXECUTION_TRACKER.md`, `tsconfig.json` |
| #13 + #14 | `.github/workflows/ci-pr.yml`, `docs/BIDMASON_EXECUTION_TRACKER.md` |
| #13 + #15 | `.github/workflows/ci-pr.yml`, `docs/BIDMASON_EXECUTION_TRACKER.md`, `tsconfig.json` |
| #14 + #15 | `.github/workflows/ci-pr.yml`, `docs/BIDMASON_EXECUTION_TRACKER.md` |

These are **overlapping changed paths**, not proof that Git will report a merge conflict or that the modules are incompatible. The largest risk is accidentally choosing one entire workflow/tracker/configuration over another. Preserve existing written decisions and each original suite's substantive steps; inspect actual three-way merge output before any PR leaves draft.

## Exact workflow job inventory from the four real source trees

Seven common named jobs must remain: `fast`, `pr`, `security`, `web-build`, `win-fast`, `pdf-qa`, `browser-e2e`.

Six additional jobs contributed by the feature branches:

| Required job after integration | Original branch | Required substantive command (not sufficient by itself) |
| --- | --- | --- |
| `db-rls` | #12 | `psql -X -v ON_ERROR_STOP=1 -f ci/db_rls_test.sql` |
| `av-real` | #12 | `node --test ci/clamav_real_integration.test.mjs` |
| `intake-db` | #13 | `psql -X -v ON_ERROR_STOP=1 -f db/typed_note_foundation.sql` |
| `item3-intake-compat` | #13 | `node --test ci/item3_item4_migration_parity.test.mjs` |
| `proposal-pdf-qa` | #14 | `python3 ci/branded_pdf_qa.py` |
| `synthetic-webhook-qa` | #15 | `node --test tests-web/synthetic-webhook-*.test.mjs` |

**Important:** These commands are only the anchor commands required by `ci/workflow_policy.py`, *not* complete substitutes for their existing jobs. The real #12 `db-rls` job executes many SQL schema/Storage/review/quota tests, separate applied-migration checks and an independent live-probe rollback rehearsal. The real #13 `intake-db` job runs dozens of SQL and Node bridge/review/race tests, and `item3-intake-compat` uses a checked-out `item3-dependency` reference and its original scripted staging setup. The #14 PDF job also runs an executable multiline review/artifact step. Do not replace any of these full jobs with a stub containing only the anchor command. Preserve Windows native fast/build and production npm audit.

The **expected integrated count is 13 distinct required jobs**, all completed/success on the **same actual integrated commit**, with zero missing, skipped, pending, failed, or conditionally nonblocking jobs. Also inspect each job's original commands and dependency order, not only the count. GitHub may report a successful workflow even when a job is intentionally skipped; missing/skipped is not acceptance.

## Supabase readiness: connected observation, not H01/H02 approval

The connected Supabase project explicitly named **BidMason** was observed `ACTIVE_HEALTHY` with **no development database branches**. On 2026-10-22, read-only aggregate `COUNT(*)` queries for all eight BidMason tables and both BidMason views returned **zero rows**. This corroborates the earlier [read-only environment inventory](ITEM6_CONNECTED_ENVIRONMENT_INVENTORY.md): no independently signed-in synthetic tenant pair or private synthetic Storage test fixture is established. A healthy database and applied baseline migrations do **not** prove two-user RLS, private Storage, import/migration compatibility with draft branches or functioning customer identity.

Do not provision accounts, JWTs, objects, or SQL using a production administrator credential merely to obtain green acceptance evidence. **H01** requires two genuine independently authenticated synthetic users/organizations and scoped revision records, plus negative read/write/revocation tests. **H02** requires two separate synthetic private objects, foreign/public access denial and the missing signed-link/write/revocation/AV tests. If a separate billable staging environment is required, its creation and cost need the authorized owner's decision; no such environment was created here. No production grant, Storage policy or RLS change was made.

The existing [H01](ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md) and [H02](ITEM6_H02_STORAGE_READONLY_PROBE.md) read-only probes deliberately **do not** provision fixtures and have not run against two real signed-in user sessions. Their offline mocked-transport CI cannot satisfy H01/H02, even when all tests pass.

## Ordered continuation and hold points

1. **Do not merge drafts merely because individual CI passed.** First determine if Item 3's real Auth/RLS/private Storage prerequisites and independent staging acceptance can be demonstrated. Record environment owner and evidence outside this public repository, never tokens/IDs/customer data.
2. When safe to integrate, proceed in dependency order **#12 → #13 → #14 → #15**, on the appropriate existing work branch/PR, preserving one Issue/branch/PR per slice. Re-evaluate draft status and required external approvals at each transition; do not force-rewrite `dev` or bypass checks.
3. Resolve overlapping `tsconfig.json` exports/path resolution and `ci/workflow_policy.py` under the actual combined compiler/import behavior. Reconcile Postgres schema/migration order and rerun negative tenant authorization, intake pricing, PDF revision QA, and delivery suppression/replay tests on the **combined code**, not merely isolated feature branches.
4. Retain all **13 full** Actions jobs, verify all named jobs and all meaningful steps on the exact integrated SHA; run the existing CI policy and actual SQL/migration test suites. A simulated workflow union or source-presence checker is supplementary, never sufficient.
5. Revisit H03–H13 live independently reviewed consent, approvals, provider identity, webhook replay, transactional dispatch, buyer response, recovery and written go/no-go. `ITEM6_RELEASE_EVIDENCE.json` stays `releaseState: blocked`, `releaseAuthorized=false`. No live send, buyer portal, production publish or `main` promotion.

**Result of this inspection:** Concrete source overlap, workflow ownership and missing live test preconditions are identified; nothing is claimed merged, deployed, independently accepted or release-ready.
