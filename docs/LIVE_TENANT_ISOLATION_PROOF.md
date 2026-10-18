# Real two-session Auth, receipt and Storage isolation proof

**Status:** executable read-only proof prepared but **NOT YET EXECUTED WITH GENUINE SESSIONS**. This does not provision identities, configure permissions, seed files or make customer uploads available. Use only with two approved synthetic test identities in *different* existing BidMason tenant organizations and two *existing* privately stored, hash-bound evidence receipts.

## What is verified

The operator-only entrypoint \`scripts/verify_live_evidence_isolation.mjs\` calls \`verifyLiveEvidenceIsolation()\` from \`lib/live-evidence-isolation.ts\` using the fixed project \`jgbogpunyzkoytrclqdl\`. It refuses to proceed unless each JWT can be verified against real Supabase Auth and represents a separate identity with an authorized membership in their expected organization, **without cross-membership**. Each user's own existing receipt must be visible through tenant RLS and the full server-side private download must hash-verify the actual Storage bytes. Then each user separately attempts to read the *other* tenant's existing object through the raw Storage authenticated endpoint, requiring an actual 401/403/404 (a 5xx outage is **not** an acceptable denial); queries foreign receipt rows via the PostgREST Data API, requiring \`[]\`; and verifies application-level denial. The tool never returns document bytes, uses only signed-in bearer tokens/publishable key, and neither writes nor deletes data.

Its deterministic unit tests use mocked Auth/PostgREST/Storage calls, proving the harness rejects data leaks, same identity, shared organizations, invalid fixture paths, tampered receipt bytes and outages. **Green unit tests are not green live-session testing.**

## Live operator prerequisites

Obtain two real approved synthetic Auth sessions, two separately provisioned test companies and pre-existing evidence files plus trusted receipts, all in BidMason's approved dedicated test environment. Keep JWTs and publishable key in local transient secure environment variables, never paste tokens or passwords into chat, issues, logs, GitHub commits or Actions. Supply the following **environment variable names**, never their values:

\`BIDMASON_LIVE_ISOLATION_APPROVED=read-only-existing-fixtures\`
\`BIDMASON_TEST_PUBLISHABLE_KEY\`
\`BIDMASON_TEST_TOKEN_A\`
\`BIDMASON_TEST_TOKEN_B\`
\`BIDMASON_TEST_ORG_A\`
\`BIDMASON_TEST_ORG_B\`
\`BIDMASON_TEST_RECEIPT_A\`
\`BIDMASON_TEST_RECEIPT_B\`

Run \`node scripts/verify_live_evidence_isolation.mjs\` **only in the preapproved secured test session**. It intentionally exits nonzero when fixtures or the approval marker are absent. On success only count totals are reported; on failure no JWT or document contents are logged.

**What remains even after a passing live read-only proof:** real signed-in create/upload path, anti-malware scanning with maintained production definition freshness, quota authenticated RPC with securely deployed service key, owner/operator vs uploader same-tenant cases, actual session revocation, deletion races/orphan retention and ingress protection. There are no fixture secrets or sign-in details committed in the repository. Do not count this as the complete Item 3 acceptance gate.


## Deadline-consistent independent denial checks (2026-10-18)

Direct authenticated Storage denial and foreign PostgREST receipt checks now
share read-only proof helpers with the same deadline used for HTTP headers and
response processing. Storage must return 401/403/404 before its 12-second
provider signal expires; receipt metadata must return HTTP 200 with a complete,
bounded [] body before its 10-second signal expires. Both cross-tenant and
same-tenant probes use these rules. Expired replies, incomplete streams,
provider failures and unintended visibility fail closed. Mocked deadline
regressions do **not** replace approved genuine-session security verification
and never enable customer evidence downloads.
