## Authenticated account endpoint (not a sign-in flow)

The server-only `GET /api/account` endpoint verifies the bearer token against the **real BidMason project's** Supabase Auth `/auth/v1/user` service, then forwards the exact token to the `bm_memberships` PostgREST query so the RLS policy still controls visibility. It never accepts caller-provided organization IDs, grants roles, uses `service_role`, creates accounts or records credentials. It emits `Cache-Control: no-store, private`, and returns no provider response bodies when upstreams fail.

Configuration: `SUPABASE_PUBLISHABLE_KEY` must be set **in the server deployment environment**, using the current publishable key from the BidMason project. If absent, the endpoint fails closed with HTTP 503. No key is committed, and the preview UI remains disabled/non-customer-facing. Client requests will require a genuine Supabase Auth JWT; a frontend sign-in and tenant owner provisioning are not implemented yet.

`tests-web/supabase-account.test.mjs` covers missing config, malformed tokens, verified user lookup, same-bearer forwarding to tenant RLS, invalid roles, provider errors, and unassigned users. These are mocked HTTP unit tests, **not real two-session Auth tests**. A production-ready user experience still requires deployed Auth UI, onboarding, secure Storage upload and end-to-end session tests.
