# Item 6 — External acceptance collection runbook

**Status: BLOCKED. No real recipients, sending, buyer portal, or production approval.**
**Scope:** [Item 6](MASTER_PLAN.md) / [Phase 3](BIDMASON_EXECUTION_TRACKER.md).
**Control:** [`ITEM6_RELEASE_EVIDENCE.json`](ITEM6_RELEASE_EVIDENCE.json) is the
machine-enforced inventory. The independent requirement IDs and source mappings
below are pinned by `tests/test_item6_release_evidence.py`; they are **not**
authenticated evidence or release status. No category has been independently
verified as of this runbook's creation.

**Connected metadata reconnaissance:** [BidMason Supabase read-only inventory](ITEM6_CONNECTED_ENVIRONMENT_INVENTORY.md) records observed existing RLS tables, private storage and missing live test coverage. It is **not** authenticated two-tenant H01/H02 acceptance or permission to update the release evidence status.

**H01 opt-in live read matrix:** [two-user authenticated read-only probe](ITEM6_H01_AUTHENTICATED_READONLY_PROBE.md) supplies 23 explicit positive/cross-tenant/anonymous GET checks, including both authenticated users' memberships, unfiltered membership and **brief revision** enumeration, and one own/other synthetic brief revision per tenant. An authorized staging operator must first provision two independently authenticated synthetic tenants and one invented brief revision per tenant; no proposal documents or hashes are returned. Offline CI exercises only a fake transport. Read-only probe output is **not** sufficient to satisfy H01: cross-tenant writes, missing membership, revoked-session tests, H02 storage and independent approval remain mandatory.

## How to assemble a review packet

1. **Identify the actual environment.** Record the intended authenticated
   Supabase project/environment, exact tenant IDs, authorized data custodian
   and operator/contractor review roles in a restricted operational record.
   Never place tenant secrets, real recipients, customer evidence or credentials
   in this GitHub source document. Unavailable or unauthorized systems stay
   unverified.
2. **Collect artifacts without declaring success.** For each criterion below,
   capture a durable, access-controlled evidence reference, implementation
   commit/revision, date, environment, responsible human reviewer, executed
   positive and *negative* tests, and their immutable logs/artifact hashes.
   Source paths and simulation screenshots alone do not satisfy a live criterion.
3. **Independently review.** Each artifact must be checked in the actual
   environment by an authorized person other than its implementer where
   required. A URL in the source inventory is only a claim; it cannot
   authenticate its owner, contents, coverage or approval.
4. **Submit, do not self-approve.** Only after evidence has been collected may
   a criterion be marked `submitted-for-independent-review` with acceptable
   HTTPS evidence links in `ITEM6_RELEASE_EVIDENCE.json`. Never insert
   customer secrets or personal records in source. This manifest intentionally
   has **no** `verified`, `approved`, `ready` or send-capable state.
5. **Run the offline gate:** `python3 ci/item6_release_evidence.py`, followed
   by all unchanged required PR/Actions checks at the exact reviewed commit.
   A passing inventory gate *always* yields `releaseAuthorized: false`.
   Missing, skipped, pending and failed checks are not success.
6. **Separate human release authority:** before any actual send/portal activation,
   a newly reviewed, tenant-authenticated server-side production gate and
   documented human go/no-go must check the **current** provider, organization,
   recipient, company-approved immutable revision, signed approvals, consent,
   stop-contact state, RLS and transactionally reserved dispatch at execution
   time. No part of this synthetic branch implements that permission.

## Thirteen individually required evidence packets

Each row specifies the **minimum kind of evidence and failure-mode test** to
seek, not an assertion that any test ran or any responsible party approved it.
The owner is a *role to be assigned*, not an invented person or authorization.

| # | Criterion ID | Source | Owner role / required artifact | Mandatory live negative validation |
| --- | --- | --- | --- | --- |
| H01 | `tenant-auth-and-rls` | `MASTER_PLAN:3` | Auth/data-security owner: connected staging project, membership and RLS policy inventory, scoped DB session logs | Tenant A cannot read, update, delete, enumerate or impersonate tenant B; reject missing membership and unauthorized service-role use |
| H02 | `private-tenant-storage` | `MASTER_PLAN:3` | Storage/security owner: private bucket policies, path ownership, signed-link expiry and retention evidence | Deny cross-tenant file reads, malformed uploads, expired/revoked links, traversal and unapproved public bucket access |
| H03 | `approved-company-policy` | `MASTER_PLAN:4` | Business owner and pricing reviewer: company-specific versioned configuration, provenance and explicit signoff | Refuse unapproved price rules, global default assumptions, incompatible revisions, and the unresolved customer-specific quarterly-service ambiguity |
| H04 | `exact-revision-approvals` | `BM-015b` | Verified operator and contractor: independent immutable-revision approval receipts, actor identities and recipient linkage | Changing price, source, QA hash, rendered PDF, recipient or revision invalidates prior approval; reject one-party or forged signoffs |
| H05 | `recipient-consent` | `BM-031` | Privacy/comms owner: attributable consent source, purpose, scope, capture time and withdrawal record | No verified consent or revoked consent blocks dispatch and follow-up; a later proposal must not reset opt-out status |
| H06 | `email-provider-and-domain` | `DEC-06` | Authorized operator/domain administrator: explicit provider decision, controlled sender/domain, credential ownership and sandbox verification | Reject unauthorized sender or provider, nonverified domains, secret exposure and cross-tenant credentials; do not infer a provider choice |
| H07 | `signed-webhook-replay` | `BM-030` | Provider/security owner: actual provider-native raw-body signature implementation, timestamp and event-ID persistence logs | Tampered signature, duplicate ID/conflicting payload, expired callback, wrong tenant and reordered events fail closed or reconcile durably |
| H08 | `transactional-dispatch-uniqueness` | `BM-029` | DB/communications owner: durable unique keys, transaction/RPC, concurrency and crash-recovery transcripts | Parallel duplicate requests, revision changes, retries and a simultaneous stop-contact update never yield an unauthorized/double send |
| H09 | `recipient-stop-contact` | `BM-031` | Communications/operations owner: tenant-recipient scoped reply, bounce, complaint, opt-out and won/lost suppression persistence | A reply/opt-out/bounce/complaint before or during dispatch blocks all later follow-ups across proposal revisions |
| H10 | `buyer-view-response-authorization` | `BM-033` | Buyer-access/security owner: authenticated scoped view and response trace, grant revocation/expiry and CSRF controls | Expired, stolen, reused or cross-tenant tokens reveal no private PDF and accept no response; read-only token cannot submit acceptance |
| H11 | `crm-recovery-and-observability` | `BM-032` | Operations/data owner: append-only activity provenance, queue observability, alerts, retention, recovery/restore evidence | Duplicate events, crash between provider and DB, backlog and missed callbacks recover without invented delivered state or lost suppression |
| H12 | `live-adversarial-safety-tests` | `BM-034` | Independent QA/security reviewer: executed staging tests with logs on actual tenant DB/provider adapters and exact SHA | Replay, race, wrong recipient, reply-before-send, invalid recipient, wrong RLS, token expiry and partial failures all demonstrably fail closed |
| H13 | `independent-reviews-and-go-no-go` | `MASTER_PLAN:8` | Named authorized privacy, legal, security, operations and release approvers: review records and written decision on exact revision | Any missing approval, red/skipped/absent required check, unresolved privacy/legal risk or untested rollback blocks promotion |

## Integration sequence and non-negotiable holds

**Dependency order, not a promise of completion:** H01–H04 establish trusted
tenant ownership and exact approved content; H05–H06 require verifiable consent
and an explicitly authorized provider/domain; H07–H09 require authentic,
durable and transactional event/contact controls; H10–H11 secure buyer access
and operational recovery; H12 independently exercises the **real** staging
integration; H13 collects separate written approval for the exact tested
artifact. For each transition, test unauthorized actors and negative/race
cases before progressing. This sequence is a review plan, not an alternative
to the governing tracker.

**No silent fallback:** a missing live provider, tenant configuration,
authenticated approver, recipient-consent source, RLS result or production
integration must remain an open blocker. Do not copy a synthetic HMAC key,
`consistent-internal-only` result, fictional event, or in-memory CAS result
into a real dispatch service.

**Minimum release decision record:** environment and organization, exact
artifact SHA, versions of approved proposal/policy, source references for
each of the 13 independently reviewed evidence packets, required check-run
names and per-step conclusions, negative tests and recovery drills, named
authorized reviewers, rollback/kill-switch owner, and signed **go/no-go**.
Until that record exists and an independently reviewed production-side gate
enforces it, leave Item 6 in `Developing`, PR #15 **draft/unmerged** and
`releaseState: blocked`. Do not assume merging or deploying is safe solely
because offline CI is green.

## CI isolation of fictional delivery models from live server routes

The **offline-only** TypeScript delivery helpers exercise invented events,
caller-supplied review/consent fixtures, in-memory CAS, short-lived simulated
buyer grants and nonbinding draft responses. Their green CI checks cannot
constitute production permission to send, authenticate, reveal a proposal,
accept a binding response, or close a real customer deal.

New `ci/item6_runtime_boundary.py` checks whether an executable
**live server entrypoint** can import any of these helpers. It traverses
static local ESM imports/re-exports (including multiline and type imports),
literal `require()` and `import()`, known local path aliases, and
**transitive** local modules. Live entrypoints now include all `app/**` and `src/app/**` page,
layout, template, error/loading, default/not-found and route modules;
all Pages Router pages (not just `pages/api/**`), root and `src/`
middleware/**proxy**/instrumentation, and modules declaring
`"use server"`. This matters because server-rendered pages and
shared layouts may execute server-side code even without an API handler. Unknown dynamic module loading and unresolved local
code dependencies inside these trees fail the boundary check rather than
being silently treated as safe. The static scanner checks a fixed list
of offline delivery modules; it does not claim to parse the full TS/JS
language or audit external packages.

The gate is **additive** to the pre-existing fast, PR and security suites
and executes through `ci/run.py`, including native Windows fast.
It does **not** prohibit the explicitly labeled, fictional,
non-customer-facing `/delivery-lab` page from rendering internal
simulations. The preview exception is confined to the exact
`app/delivery-lab/page.tsx` (or future `src/` equivalent), provided it
does **not** declare a server action. A shared layout, nested route handler,
or newly introduced public page under that URL receives no exception.
Forty negative/positive Python tests cover direct and transitive imports,
aliases, server actions, dynamic imports, middleware/proxy,
server-rendered pages and shared layouts, scoped pages/API routes,
unresolved modules and narrow preview isolation, including both
`lib/` and `src/lib/` source layouts. A passing gate means only
that **known static entrypoints** do not currently expose offline modules; it is **not** a guarantee of
authenticity, complete dependency resolution, real API authorization,
or production readiness. Any future real sender, webhook receiver,
buyer portal or API still requires H01–H13 live external verification.

### Offline-model path migration must not remove the guard

The scanner's fixed offline-only module prefixes are now checked against
both repository-root `lib/` and Next's common `src/lib/` layout. This
closes a source-location bypass: a future move to `src/lib/synthetic-*`
would otherwise avoid the same restriction already enforced for `lib/`.
Both roots can coexist; a protected helper in **either** root is rejected
when reachable from a live server entrypoint. Existing aliases and
transitive barrel/re-export imports follow the same rule.

Six extra adversarial tests cover a direct `src/app/api` import,
root-page alias into `src/lib`, transitive barrel resolution,
simultaneous protection of both source layouts, an unrelated permitted
`src/lib` module, and preservation of the tightly scoped fictional
preview exception. This remains static source containment only and
does not grant provider, tenant or customer authority.

### Long ESM import statements cannot evade the static boundary

The import walk no longer stops searching for an ESM `from` clause after
800 characters. A valid multiline named import, type-only import or
re-export may exceed this arbitrary cutoff; the previous bounded regex
could silently miss a dependency on an offline-only module. The static
scanner now searches to the statement boundary instead of assuming
long lists are not meaningful imports. Five additional regression tests
exercise long direct imports, transitive re-exports, type-only imports,
a later forbidden import after a long safe one, and a long unrelated
local module that must remain permitted.

This is still conservative regex-based source validation rather than
complete ECMAScript/TypeScript parsing. A passing scan does not
demonstrate real runtime isolation, provider authentication, RLS,
consent, or permission to contact customers. The existing H01–H13
release restrictions remain intact.

### Unreviewed import aliases are not external packages

The Item 6 static boundary previously resolved direct local imports but
treated unfamiliar bare specifiers as third-party packages. A future
TypeScript `compilerOptions.paths` alias, `baseUrl`, inherited
`tsconfig` mappings, `jsconfig` mapping or Node `package.json`
`imports`/`exports` field could silently redirect such an import
to an offline-only synthetic delivery model while escaping traversal.

The additive boundary now **fails closed on unreviewed module-resolution
configuration**: path aliases, base URLs, extends/references or package
import/export maps in project configuration files. Configurations are
checked within the repository, excluding dependency/build folders; invalid,
non-object or symlinked module configuration also fails CI rather than
being mistaken for a trusted absence of mappings. Normal project
configurations without those features remain permitted.

Ten adversarial cases exercise an alias mapping an apparently external
specifier to a synthetic model, nested `src/` config, a base URL, inherited
and referenced TypeScript configuration, JavaScript aliases, Node package
imports/self-exports, malformed/non-object configurations and ordinary
permitted settings. This is a conservative stopgap until an independently
reviewed real resolver and import graph are implemented. It is **not**
proof of complete static analysis, actual Auth/RLS, consent or production
send/view authorization. H01–H13 remain blocked.

## Deterministic external reviewer handoff — still BLOCKED

Runbook table cells describing reviewer roles and negative tests must remain
**plain-text instructions**. The handoff generator rejects embedded URI schemes,
web addresses, email addresses, Markdown links, HTML tags, inline code, extra
table separators and control characters in these cells rather than echoing
potentially sensitive information into the shareable packet. Only printable
ASCII characters (U+0020 through U+007E) are accepted in those English-language
checklist cells; bidirectional overrides, zero-width characters and Unicode
lookalikes must fail instead of changing what the reviewer sees. Source-controlled
text is not a safe evidence store; real references and reviewer identities
belong in access-controlled operational records. This filter reduces common
accidental leakage, but does not constitute complete PII detection or review
approval.


An offline handoff generator now joins the **exact 13 manifest criterion IDs**
to this runbook's responsible review roles, required artifacts, and live
negative tests without inferring that any criterion is satisfied.

Use `python3 -m ci.item6_review_handoff --format check` for the mandatory
CI consistency check, `--format markdown` for a private review checklist,
or `--format json` for a machine-readable evidence *inventory*. All three
modes validate the manifest's existing **blocked-only** schema and the
complete numbered H01–H13 table before producing any output. The normal
fast, PR and security gates include the consistency check alongside the
original release manifest and runtime import guards; no prior stage is
removed or made optional.

The output supplies deterministic SHA-256 fingerprints for canonical
manifest JSON and exact runbook bytes so a reviewer can identify what
source guidance was examined. The fingerprints are **not** GitHub commit
attestations, independently authenticated evidence, authorization or a
human signature. The handoff includes the required source labels, owner
roles and mandatory failure-mode tests. It provides only **counts** of
untrusted submitted evidence links, never their URLs or customer data.
An entry that has been `submitted-for-independent-review` is still
explicitly `independentlyVerified: false`. This generator has no
`approved`, `ready` or `send` output and cannot clear H01–H13.

When operational reviewers begin collecting restricted artifacts, they
must verify the actual connected environment, signed authority, exact
source revision, negative tests and independent decisions **outside**
this repository. Never attach secrets or real customer evidence to
the versioned handoff. A consistent review packet is not a substitute
for a real production-side gate or the written H13 go/no-go.
