# Item 6 H02 — opt-in, read-only private evidence object isolation

**Status: BLOCKED / unexecuted against live synthetic users.** This narrow H02 probe is a pre-review diagnostic, **not** a substitute for signed URL expiry/revocation, upload/update/delete, malicious path, file scanning, tenant RLS, or independent H02 acceptance.

## Authorized staging setup

An authorized operator must provision two **different, fictional** organizations with two genuinely independently signed-in Supabase Auth users. In the private `bm-evidence` bucket, pre-provision exactly one **invented** PDF/PNG/JPEG object for each organization, using authorized staging processes and the existing storage permission design. The two users must separately be authorized to read their own synthetic object, and not the other's. For the observed policies, the own-user test may require that user's `owner`/`operator` membership, object uploader ownership or matching verified receipt. Do not grant broader access to make the test pass. The previously inspected connected bucket was empty: **do not execute the probe and interpret blocked preconditions as a pass.**

The object names must be `<organization-uuid>/<object-uuid>.<pdf|png|jpg|jpeg>`. Only lowercase canonical UUIDs/extensions are accepted; no user names, real documents, arbitrary paths, download names, fragments, escaping or query strings. The tool refuses paths with the same organization prefix.

Supply these values as protected process environment variables, **never GitHub secrets in public logs, shell command-line arguments, issue comments or committed files**:

| Variable | Value |
| --- | --- |
| `BIDMASON_H02_URL` | Exact lowercase `https://<20-char-project-ref>.supabase.co` origin |
| `BIDMASON_H02_PUBLISHABLE_KEY` | `sb_publishable_...`; no secret/service-role key |
| `BIDMASON_H02_USER_A_JWT`, `BIDMASON_H02_USER_B_JWT` | Two distinct short-lived normal Auth user JWTs |
| `BIDMASON_H02_PATH_A`, `BIDMASON_H02_PATH_B` | Distinct pre-existing synthetic object paths in the two tenants |

## Explicit command

```bash
python -m ci.item6_storage_readonly_probe --live-readonly
```

Without `--live-readonly`, zero network requests are performed. In explicit mode the script validates tokens/paths, then verifies **both identities** using `GET /auth/v1/user`. Before accessing any object, the probe also requires each user to have an exact positive `bm_memberships` row for the organization UUID in that user's object path, while organization-scoped listing of the other tenant's memberships must return an empty array. All four authenticated membership checks require HTTP 200 with exact results. This prevents passing with arbitrary authenticated identities unrelated to the seeded object owners. Only the exact Supabase host is contacted, with environment proxy use and redirects disabled. It makes six bounded `GET /storage/v1/object/authenticated/bm-evidence/<synthetic-path>` calls **plus four public-route** `GET /storage/v1/object/public/bm-evidence/<synthetic-path>` calls (two with no API key at all, two with a publishable API key), all using `Range: bytes=0-0` and a short timeout. No public-route request sends a user Authorization header; the first two use **no API key or other credentials**, and the remaining two use **only the publishable key**. This tests both keyless browser access and anonymous client access. It never creates objects, edits buckets, requests signed URLs, or sends emails. The response body is discarded. The probe demands a **206 Partial Content** and a valid `Content-Range: bytes 0-0/<positive-size>` with exactly one returned byte for each authorized own-object positive control. If a gateway does not honor Range, the probe **blocks** rather than downloading a full document; an operator must independently validate Range support and the H02 test plan. It does not attempt to fix a provider response.

The sixteen checks comprise: both Auth identities, **each user's own positive membership and foreign-tenant membership-list denial** (four checks), each user's own-object positive control and other's object denied (HTTP 401/403/404), anonymous access to both objects on the authenticated route denied (401/403/404), and **both keyless and publishable-key public-route access** to both object paths denied (401/403/404). This last check detects accidental public bucket exposure that could be missed when inspecting only the authenticated Storage endpoint. A missing own object, any leaked foreign/anonymous byte, a redirect, HTTP 200 full download, a server error or an unexpected return code is a blocker. **Denial responses (401/403/404) must have a demonstrably empty body to pass this narrow diagnostic:** the transport now reads at most one denied-response byte and returns an opaque presence flag. A missing/unreadable response stream, an ordinary nonempty Supabase JSON error envelope or a leaked data byte all block the check until separately reviewed under restricted access. A successful HTTP status with a denied body is never counted as proof of tenant isolation. This conservative rule may block normal provider error envelopes; it does not relax the requirement to validate actual object denial with an authorized reviewer. There is no success-by-unavailable-service path. Results include **only check names and pass/fail booleans**; JWTs, organization IDs, object URLs/paths, bytes and provider error bodies are never printed.

Even a green 16/16 report is **`requires-independent-review`, `h02Accepted: false`, `releaseAuthorized: false`**. The Storage backend's actual enforcement, externally collected logs and independent reviewer must still be validated, including write and signed-link scenarios.

## Incomplete H02 requirements

Private Storage **signed URL creation/expiry and revocation behavior** is not tested by these GETs. In Supabase, signed URLs are bound to a dedicated storage signing key and ordinarily remain valid until expiration even if Auth signing keys change; do not infer that signing out revokes an already-issued signed URL. Signed URL revocation needs a separate threat-model-specific and provider-supported plan. Also test tenant-scoped uploads, forbidden upserts/deletes, MIME/size limits, malicious names, incomplete receipts, membership removal and token-session revocation in a controlled **synthetic** staging environment; document independent security/privacy review and retain redacted evidence in restricted storage.

The offline suite `tests/test_item6_storage_readonly_probe.py` uses fake identities and HTTP responses only. GitHub Actions **never runs the live command or provisions objects**. Passing unit/CI tests is not production H02 acceptance.

**H01–H13 independent acceptance: unverified. No customer delivery authorized.**
