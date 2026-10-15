# BidMason

BidMason is a commercial contractor website, proposal and follow-up project. The source of truth is this repository: `main` is production and `dev` is integration. Every implementation slice is tracked through an Issue and work-branch PR.

## What actually exists

- **Development preview:** Next.js 16 + React 19 + TypeScript website at the repository root. It is intentionally marked **internal preview**, `noindex` and **does not accept or claim to submit leads**. No hosted deployment is verified.
- **Source baseline:** the full implementation plan and execution tracker in `docs/`; historical operating policies, nine drafting prompts and synthetic Harbor Coast records. **28 of 32** original archive entries are imported and byte-verifiable; the original two HTML websites, Python PDF generator and demo PDF remain in the uploaded source ZIP, not this Git branch.
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

The `web` stage requires `npm ci` first. It runs typechecking, web tests, a production build and live HTTP smoke test. Publishing the preview or migrating historical claims/forms needs explicit review and a separate acceptance gate.

## Project navigation

- [Eight-slice execution plan](docs/MASTER_PLAN.md)
- [Original comprehensive blueprint](docs/BIDMASON_MASTER_IMPLEMENTATION_PLAN.md)
- [Execution tracker](docs/BIDMASON_EXECUTION_TRACKER.md)
- [Source integrity and inventory](docs/SOURCE_INVENTORY.md)
- [Web preview limitations](docs/WEB_PREVIEW.md)
- [CI operating contract](docs/CHATFREEPT_CI.md)

The original company operating README is preserved unchanged as [historical source](docs/HISTORICAL_SOURCE_README.md); historical promotional policies do not override the current product, privacy or approval requirements.
