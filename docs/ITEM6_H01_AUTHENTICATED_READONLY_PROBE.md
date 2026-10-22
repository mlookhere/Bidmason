# Item 6 H01 — opt-in authenticated read-only RLS probe

**Scope:** [H01 in the acceptance runbook](ITEM6_EXTERNAL_ACCEPTANCE_RUNBOOK.md).
**State:** Unexecuted against real user sessions; **BLOCKED** for release. This probe supplies a reproducible subset of future H01 live evidence; it does not replace the required two-user authorization audit, negative write tests, membership revocation tests, or independent review.

## Preconditions

An authorized staging operator must first provision **two different test users and two distinct synthetic organizations**, each user a member of exactly one organization. Both organization rows and matching memberships must exist and be visible to their own real user sessions. The currently observed empty BidMason environment does **not** satisfy these preconditions. Obtain short-lived signed-in user access JWTs through normal Auth, and a **publishable**, not secret/service-role, API key. Never provision users, membership, credentials or data with this probe. Do not use genuine customer records or grant service bypass privileges.

Provide these environment variables **in a protected execution session**, without committing them, printing them, or placing tokens in command arguments:

| Environment variable | Required input |
| --- | --- |
| `BIDMASON_H01_URL` | Exact HTTPS project URL (`https://<20-char-project-ref>.supabase.co`) |
| `BIDMASON_H01_PUBLISHABLE_KEY` | Project publishable key (`sb_publishable_...`); no secret, service-role or legacy privileged key |
| `BIDMASON_H01_USER_A_JWT` / `BIDMASON_H01_USER_B_JWT` | Two different unexpired authenticated Supabase Auth user JWTs |
| `BIDMASON_H01_ORG_A` / `BIDMASON_H01_ORG_B` | Different UUIDs for the synthetic organizations belonging respectively to users A and B |

## Invocation

```bash
python -m ci.item6_rls_readonly_probe --live-readonly
```

Without `--live-readonly`, the command refuses execution and sends **zero** network requests. With explicit opt-in, the only network calls are bounded HTTPS `GET` requests to the exact supplied Supabase host's `/auth/v1/user` and `/rest/v1/` **organizations/memberships** paths. Redirects and environment proxies are disabled. The tool does not upload/download objects, write any table, refresh Auth sessions or contact buyers.

The 16-case read matrix verifies:

- Both bearer sessions resolve through Auth to distinct actual users (not only unverified JWT payload claims), **before either user can make a tenant data request**.
- For each user: own synthetic organization visible, other synthetic organization invisible, tenant enumeration limited to that user's single synthetic organization.
- For each user: own exact membership visible, the **other authenticated user's actual membership** in the other organization invisible, and unfiltered membership enumeration limited to that user's single synthetic membership.
- Anonymous organization and membership listings reveal no synthetic tenants or identities.

Each test expects HTTP 200 and an exact, minimal JSON array. A missing own record, inaccessible API, leaked other-tenant row, malformed response, bad token, wrong hostname or disallowed key **fails**; it cannot be interpreted as a pass because a denied read returned no data.

The output contains only test names, booleans and non-authorizing state. Even when 16/16 pass, the result is `state: requires-independent-review`, `h01Accepted: false` and `releaseAuthorized: false`. Errors are printed generically without credentials, tenant IDs or provider bodies. Keep raw system logs under restricted access; obtain separate authorized reviewer signoff and exact execution evidence before H01 may advance.

## Still mandatory

Read-only checks are **not** proof of negative SELECT over every table; denied INSERT/UPDATE/DELETE; orphaned/missing membership; stale/revoked sessions; impersonation attempts; service-role misuse; cross-tenant storage and signed-link denial; or external operational signoff. Complete these independently through controlled synthetic staging tests. H02–H13 remain completely separate release gates.

Unit tests (`tests/test_item6_rls_readonly_probe.py`) use only an in-memory fake transport. They verify positive controls, cross-tenant **other-user** membership leakage, filtered versus unfiltered membership enumeration, anonymous leaks, two-session Auth ordering, invalid auth, endpoint/key/token validation and default non-network behavior. **GitHub Actions never supplies live JWTs or performs live tenant reads.**

**Current live H01 acceptance: UNVERIFIED. Production dispatch and buyer access remain disabled.**
