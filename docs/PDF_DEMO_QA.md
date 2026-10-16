# PDF regression fixture (internal only)

A new ReportLab renderer consumes an **already priced JSON snapshot** and never computes commercial pricing or invokes remote services. The Next/Node pricing code is the pricing authority for the synthetic fixture; Node tests reconcile all nine unit-price amounts.

`fixtures/demo_snapshot.json` describes fictional Harbor Coast names and scope. The quarterly inclusion choice is marked `fixtureAssumptionOnly`: the example leaves inclusion and additional cost **unset**, so no unapproved business term is implied. The historic $475 standalone amount is treated as background context, not a Full Property quote. This **does not resolve the actual commercial decision** in Issue #3 or authorize sending a quote.

The PDF is stamped `SYNTHETIC DEMO - NOT FOR DELIVERY` on every page, uses real vector-drawn empty option boxes instead of unsupported Unicode checkbox fonts, and omits unverified license/insurance claims and internal notes. Section 8 acceptance is disabled for the demo. The two-page output was rendered and visually inspected during development; acceptance is enforced by a separate `pdf-qa` GitHub job using ReportLab and PyMuPDF. The job checks extracted prices/sections/claims, page geometry, all pages rendered to pixels, vector boxes, and rejection of any quarterly pricing before owner approval, including contradictory included-plus-billed prices.

```bash
python3 -m pip install -r requirements-pdf.txt
bash ci/run pdf
python3 scripts/render_demo_pdf.py --input fixtures/demo_snapshot.json --output /tmp/bidmason-demo.pdf
```

The original 2026 PDF remains byte-identical in the historical source archive for regression comparison; it is not silently overwritten, approved or published. The synthetic output is a QA baseline, not a production release.
