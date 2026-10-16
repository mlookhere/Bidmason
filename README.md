# BidMason

BidMason is a commercial contractor website, proposal and follow-up project. The source of truth is this repository: `main` is production and `dev` is integration. Every implementation slice is tracked through an Issue and work-branch PR.

## What actually exists

- **Development preview:** Next.js 16 + React 19 + TypeScript website at the repository root. It is intentionally marked **internal preview**, `noindex` and **does not accept or claim to submit leads**. No hosted deployment is verified.
- **Source baseline:** the full implementation plan and execution tracker in `docs/`; historical operating policies, nine drafting prompts and synthetic Harbor Coast records. **All 32 original archive entries are preserved and byte-verifiable**: 28 stored as original text; the two original HTML sites, Python PDF generator and historical PDF encoded losslessly in `historical-source/legacy-assets.lzma.b64` (not publicly served). `python -m scripts.source_bundle` restores them to a quarantine directory; CI verifies all four SHA-256 checksums.
- **CI:** Python fast/PR/security validation and a required Next web-build job with locked npm dependencies, production dependency audit, TypeScript checks, UI source tests, production build and HTTP smoke test.
- **Not implemented:** persisted lead forms, tenant login/database, structured proposal pricing, approved PDF rendering, customer sending, CRM, billing, production hosting. The historical ZIP is neither a deployed application nor approval to publish its claims.

## Local development

Requires Python 3.12+, Node 24+ with npm.

```bash
bash scripts/bootstrap --ci
npm ci
npm run dev
```

Run checks:

```bash
bash ci/run fast
bash ci/run pr
bash ci/run security
bash ci/run web
```

On Windows (PowerShell):

```powershell
.\scripts\bootstrap.ps1 -CI
npm ci
.\ci\run.ps1 fast
.\ci\run.ps1 pr
.\ci\run.ps1 security
.\ci\run.ps1 web
```

The `web` stage requires `npm ci` first. It runs typechecking, web tests, a production build and live HTTP smoke test. Publishing the preview or migrating historical claims/forms needs explicit review and a separate acceptance gate.

## Project navigation

- [Eight-slice execution plan](docs/MASTER_PLAN.md)
- [Original comprehensive blueprint](docs/BIDMASON_MASTER_IMPLEMENTATION_PLAN.md)
- [Execution tracker](docs/BIDMASON_EXECUTION_TRACKER.md)
- [Source integrity and inventory](docs/SOURCE_INVENTORY.md)
- [Web preview limitations](docs/WEB_PREVIEW.md)
- [CI operating contract](docs/CHATFREEPT_CI.md)

The original company operating README is preserved unchanged as [historical source](docs/HISTORICAL_SOURCE_README.md); historical promotional policies do not override the current product, privacy or approval requirements.
