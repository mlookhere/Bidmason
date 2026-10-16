# Preview browser validation (CI)

This is an actual **Chromium integration test**, not a source grep or a synthetic layout assertion. The `browser-e2e` job installs the pinned Playwright Python package and compatible browser, builds Next.js with the committed npm lock, starts the production server and exercises:

- Widths **320, 375, 768 and 1280 pixels** with real DOM scroll-width measurement; no horizontal overflow.
- Semantic banner, main, navigation, contentinfo and a single H1; skip link first in keyboard tab order, visible keyboard focus and functional fragment links.
- Mobile navigation touch targets at least 44px high; working approach/capabilities links and CTA.
- `prefers-reduced-motion: reduce` scroll behavior.
- No visible or hidden input form, no live lead submission claim, no unexpected non-GET request.
- `noindex`, preview disclaimers, zero uncaught page errors, and direct 404 responses for the original historical site, archive payload and placeholder intake endpoint.
- Full-page screenshots during the test (temporary CI runner files only; no user or prospect data).

Run locally only after `npm ci && npm run build && python -m pip install -r requirements-browser.txt && python -m playwright install chromium`:

```bash
python ci/browser_qa.py
```

This is **preview-only validation**. It does not establish a persisted production form, real mobile-device matrix, customer permission to publish, or an accessible finished CRM. A future authenticated intake must replace the explicit no-form guard with actual authorization and persistence E2E tests.
