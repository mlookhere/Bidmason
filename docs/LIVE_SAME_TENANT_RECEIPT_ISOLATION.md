# Read-only same-tenant evidence privacy verification

The existing genuine two-tenant harness tests cross-tenant isolation, but it cannot independently verify whether a second contractor in the SAME organization can access an uploader's evidence or receipt metadata. The additional verifySameTenantEvidencePrivacy function tests this missing security property without creating or modifying any account, receipt or Storage object.

Prerequisites: Two different currently authenticated, existing synthetic users assigned to one organization. The first user has a pre-existing immutable receipt and private Storage object (which the harness reads and verifies by SHA-256). The second is strictly a contractor and is not the uploader of that receipt. This function refuses duplicate user identities, cross-organization sessions, missing memberships, and elevated reviewer roles for the second actor.

The proof verifies one positive uploader download, then three independent denials for the other contractor: direct private Storage object read (must explicitly be 401, 403, or 404), exact path/organization-scoped PostgREST receipt metadata read (must be 200 with a strictly empty bounded response), and the normal application download (must be 404). Provider errors, altered payloads, oversized JSON or unexpected access all FAIL; they are never interpreted as a successful denial.

Manual opt-in: set BIDMASON_LIVE_ISOLATION_APPROVED=read-only-existing-fixtures and supply BIDMASON_TEST_PUBLISHABLE_KEY, BIDMASON_TEST_TOKEN_UPLOADER, BIDMASON_TEST_TOKEN_OTHER_CONTRACTOR, BIDMASON_TEST_ORG, and BIDMASON_TEST_RECEIPT_PATH through an approved private secret injection method. Run node scripts/verify_live_same_tenant_receipt_isolation.mjs. Never paste bearer tokens into GitHub issues, CI logs, chat messages, PRs or customer-visible artifacts.

Status: Tested offline with simulated HTTP responses ONLY. The dedicated Supabase project has no approved real Auth/evidence fixtures, so no genuine same-tenant API verification has been executed. The script must not be added as a falsely-green CI gate or used to declare production approval. Keep uploads/downloads disabled and PR #12 draft.
