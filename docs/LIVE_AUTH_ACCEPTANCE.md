# Live Auth tenant-membership acceptance (operator only)

The script \`scripts/verify_live_auth_memberships.mjs\` is a **manual,
temporary-fixture test** for the dedicated BidMason Supabase project
\`jgbogpunyzkoytrclqdl\`. It is not a public endpoint, a production
Auth flow, or a CI test that can be marked green without genuine provider
sessions.

It first requires an **empty** dedicated project (no Auth users,
organizations, memberships or receipts). It uses an Auth Admin API
privileged credential to create **four confirmed synthetic users**
with randomly generated passwords and \`@example.com\` reserved
test addresses (the Admin API does not send confirmation emails),
two organizations and tenant memberships. Every user signs in through
the real Supabase Auth token endpoint and then validates their own
single RLS-scoped membership and the denial of foreign memberships.
It removes one membership and proves a previously issued JWT can no
longer see that membership.

All created memberships, organizations and Auth accounts are removed
in \`finally\`, even on intermediate failures. Cleanup failure is an
explicit error; **verify empty live counts afterward** before any retry.
No evidence object, receipt or customer upload/download API is created
or enabled. This does **not** satisfy the separate positive and negative
receipt-backed Storage byte-transfer, scanner freshness, quota traffic
or JWT session-revocation acceptance tests.

Requirements for a separately provisioned, private trusted operator
process: Node 24, an explicitly authorized acceptance window, genuine
\`BIDMASON_LIVE_SERVICE_ROLE_KEY\` and
\`BIDMASON_TEST_PUBLISHABLE_KEY\` from the dedicated project, with
\`BIDMASON_LIVE_AUTH_APPROVED=temporary-auth-users-only\`. Never
commit/paste credentials or inject them into arbitrary websites, chat,
PR comments or an automatically triggered GitHub Actions job. The
script deliberately refuses to run under CI. Use only when direct,
secure Auth Admin credentials are available; the connected Supabase
project-management integration does not currently expose Auth Admin
create/delete-user operations.

The automated \`tests-web/verify-live-auth-memberships.test.mjs\`
uses a synthetic in-memory HTTP mock for refusal, positive RLS,
revocation and cleanup-failure regression tests. Those offline tests
do **not** count as genuine Auth integration.

Do not substitute edits to \`auth.users\`, fabricated JWT claims, or an
unprotected Edge Function. Customer evidence routes remain disabled and
PR #12 remains draft until the distinct live release gates pass.
