# BidMason web preview (not production)

The root Next.js application is a deliberately limited **not access-controlled** development preview, not the historic 2026 marketing site and **not** a live BidMason SaaS.

## Current behavior
- Responsive branded landing page with roadmap sections; no lead capture, login, upload, quoting, proposals, or payments.
- Visible internal-preview notice and `noindex,nofollow` metadata. No testimonials, contractor credentials, or fake conversion numbers.
- A real headless web build is required in CI before a branch can be merged.
- `npm run dev` starts a local preview only. Deployment is not configured and publication requires operator approval.

## Source separation
Original historical HTML and PDF artifacts remain unsafe for external publication until Issue #3 resolves DEF-01..DEF-10, including form persistence, credential claims, pricing, PDF glyphs and mobile navigation. Do **not** copy historical JS form-success handlers into the new app.

## Dependencies
Use locked Next 16.4.0 and React 19.3.1 for the initial web preview; TypeScript 6.0.2 retains the compatibility expected by Next's JavaScript TypeScript compiler integration. A checked-in `package-lock.json` from a successful GitHub Actions build locks the dependency tree. CI runs `npm ci`, audits production dependencies and performs a real TypeScript check, web tests and Next production build; no dependency resolution is skipped.

## Real CI evidence

The [Actions run 38747877843](https://github.com/mlookhere/Bidmason/actions/runs/38747877843) executed the actual Next production build and HTTP smoke test on commit `b5330a0`: four jobs passed, `npm ci` installed the checked-in dependency lock, production audit returned zero vulnerabilities, and the preview's no-form/noindex notices were verified in the served HTML. This is a tested preview, **not** a production deployment or tested lead submission.

## Publication safety

`ci/publish_guard.py` runs in fast/PR/security CI and rejects historical source files under served Next/public paths, known fake-success form patterns, and loss of noindex/disabled-intake notices. Negative tests verify each guard. This is a transitional scaffold policy, not a replacement for real intake persistence, access controls or compliance review. Before approving a live website, replace the preview-only checks with independent, end-to-end backend, authorization, abuse-control, consent, and customer-data tests.

**Important:** `noindex` is only search crawler guidance and is not an access restriction. No secret or customer-specific data is safe merely because a route is marked noindex.
