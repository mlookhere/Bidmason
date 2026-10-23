# Item 6 — existing-project synthetic H01/H02 fixtures

**Scope:** Existing connected Supabase project explicitly named **BidMason** (not a new project or billed development branch). **Status: PARTIALLY SEEDED / H01 AND H02 NOT YET ACCEPTED.** User chose this project for fixtures on October 22, 2026. This is a *synthetic test-only* plan, not permission to merge, email buyers, enable production routes or claim the thirteen external criteria are satisfied.

## Verified database seed

A guarded SQL transaction created exactly two `bm_organizations` rows:

| Organization slug | Display label | Purpose |
| --- | --- | --- |
| `bm-synthetic-h01-h02-20261022-a` | TEST ONLY - BidMason synthetic tenant A | Tenant A positive and foreign negative checks |
| `bm-synthetic-h01-h02-20261022-b` | TEST ONLY - BidMason synthetic tenant B | Tenant B positive and foreign negative checks |

Before seeding, the named project had zero actual Auth users, organizations, memberships, revisions and private objects. The transaction checked those counts were still zero. A separate read-only verification after commit returned **2 total organizations, 2 tagged synthetic organizations, 0 Auth users, 0 memberships, 0 revisions, 0 private objects, one existing private `bm-evidence` bucket**. **Only these two organization rows were written.** Their UUIDs and all future user IDs/tokens are deliberately withheld from public GitHub artifacts. Existing schema, Storage policies, Auth config and project migration history were not changed.

**The user has approved using the existing project**, so *no new staging project or billed database branch should be created*. That decision does not supply an Auth Admin secret, permit direct fake `auth.users` insertion or turn service-role SQL into authenticated-user proof.

## Remaining fixture completion using real Supabase Auth

Use the guarded local operator tool `scripts/item6-provision-live-fixtures.mjs` from the repository root. It is never invoked in CI, public browser routes or server runtime. It uses the official Supabase Auth Admin HTTPS API to create **exactly two email-confirmed synthetic users** using reserved `example.test` addresses with generated in-memory passwords; it then signs in each independently through GoTrue's normal password endpoint. It never inserts into `auth.users` with SQL and never logs or persists passwords, JWTs, project keys, tenant UUIDs or object paths.

After checking the exact two preseeded organization slugs and confirming the Auth project still has zero existing users, the tool performs these **scoped** actions:

1. Create two independently confirmed **synthetic** users using the operator's privileged Auth Admin credentials and authenticate both with real password grants.
2. Add one owner membership per synthetic organization via the service-role REST endpoint, without modifying any RLS policy or user grant.
3. As each signed-in user, submit one minimal `bm_brief_revisions` row (`document = {}`, with matching SHA-256) using that user's JWT and existing authenticated insert policy.
4. As each signed-in user, upload a tiny inert 1x1 PNG file into the private `bm-evidence` bucket under `<organization-uuid>/<object-uuid>.png`. No file contains customer information. Existing object owner/membership policies apply; any denial **blocks**, without relaxing Storage.
5. In the **same operator process**, run the existing opt-in [H01 Auth/RLS read-only probe](ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md) and [H02 private-object probe](ITEM6_H02_STORAGE_READONLY_PROBE.md), passing ephemeral JWTs through child process environment variables—not arguments or logs. Each report is reduced to `requires-independent-review` or `blocked`. Neither result independently accepts H01/H02, tests writes/revocation or authorizes release.

The operator must obtain the necessary **publishable** and **protected administrator/service** API keys using the Supabase dashboard, supply them **only as local protected environment variables**, and run this command on a machine with outbound HTTPS and Python. This conversation's tools can read/write project SQL but **cannot create GoTrue Auth sessions or upload Storage files**; the container is network-isolated. Do not share these keys in chat, GitHub issues, PR comments or logs.

### Required environment variables

| Variable | Description |
| --- | --- |
| `BIDMASON_FIXTURE_URL` | Canonical exact `https://<20-character-ref>.supabase.co` URL for existing BidMason project |
| `BIDMASON_FIXTURE_PROJECT_REF` | Exactly matching project reference, obtained from the selected project's dashboard |
| `BIDMASON_FIXTURE_PUBLISHABLE_KEY` | The project's enabled `sb_publishable_...` key |
| `BIDMASON_FIXTURE_ADMIN_KEY` | Protected `sb_secret_...` or legacy admin service-role token; **never a browser/publishable key** |
| `BIDMASON_FIXTURE_ACKNOWLEDGE` | Exact literal `EXISTING_BIDMASON_SYNTHETIC_FIXTURES_ONLY` |
| `BIDMASON_FIXTURE_PYTHON` | Optional Python executable name, default `python3`; on Windows commonly `python` |

### Local invocation

```powershell
# Set the URL/ref and keys privately from the EXISTING BidMason dashboard.
# Do not paste keys into versioned files, the terminal history or a chat.
$env:BIDMASON_FIXTURE_ACKNOWLEDGE = 'EXISTING_BIDMASON_SYNTHETIC_FIXTURES_ONLY'
$env:BIDMASON_FIXTURE_PYTHON = 'python'
node .\scripts\item6-provision-live-fixtures.mjs --provision
```

Running without `--provision`, with the wrong host/project ref, missing secrets, missing confirmation, unexpected seeded names or **any existing Auth user** refuses the operation before creating any accounts. Tests in `tests-web/item6-provision-fixtures.test.mjs` exercise local no-network failure modes; they **never** provision users.

**Caution on partial failures:** This is intentionally a one-shot fixture operation. External APIs are not one cross-service transaction. A failure after the first actual Auth user or Storage object may leave **partial synthetic fixtures**. The next run refuses if Auth users exist; do not manually bypass that guard or overwrite arbitrary users. Inspect the tagged `app_metadata.bidmason_test_fixture` identities, related tenant-scoped rows and the exact private object paths with an authorized administrator before choosing a *documented*, narrowly scoped cleanup or recovery. Never delete real accounts or assume signup succeeded solely because an organization exists.

## Live acceptance remains blocked

Even after successful provisioning and green H01 27-case / H02 16-case *read-only* diagnostics, independent authorized reviewers must still document cross-tenant **writes**, membership/session revocation, signed URL expiry/revocation, Storage object replacement/delete denials, malicious paths, malware handling, positive/negative approvals, provider-native signatures, transactional sending, buyer access, recovery and H03–H13. The actual combined PR tree must execute all **13 full CI jobs** on the same integrated SHA before integration/release consideration.

**`releaseState=blocked`, `releaseAuthorized=false`, PR #15 draft, Issues #7/#1 open.**

## Automated operator safety hardening — October 22, 2026

The fixture command now **pins the existing, explicitly approved BidMason Supabase project reference `jgbogpunyzkoytrclqdl`**, not merely any syntactically valid matching URL/ref pair. The public project reference is not a credential. Requests to a different valid Supabase project refuse before any network calls. The command still requires the canonical project URL, protected Admin key, publishable key, explicit acknowledgment, and empty Auth-user preflight.

The H01/H02 diagnostic child processes receive an explicit **allowlist of 14 probe-specific environment variables**, plus minimal platform variables needed to start Python. The fixture Admin key, other application secrets, proxy settings and arbitrary ambient environment variables are **not forwarded**. The access JWTs supplied to each diagnostic remain ephemeral in its process environment, and the probes never log tokens. See `scripts/item6-fixture-process-env.mjs` and the dedicated offline negative tests. No connected project settings, user sessions, bucket permissions or live migrations changed for this hardening.

**This hardening was implemented and tested offline; actual Auth/Storage provisioning and manual H01–H13 acceptance remain deferred and unverified.**
