# Original BidMason ZIP source inventory

Input: uploaded `bidmason.zip` (June 2026 synthetic/business snapshot). This is the audit's historical artifact, not a production deployment or proof of customer results. Path names below are relative to archive root `bidmason/`. Checksums are first 16 hexadecimal characters of SHA-256. The complete ZIP includes **32 files**, 184,134 uncompressed bytes. Source import is incomplete.

| File | Bytes | SHA-256 prefix |
|---|---:|---|
| agents/01-market-analyst.md | 3475 | e5f16cf73c98a53e |
| agents/02-offer-architect.md | 3654 | 3c4fd77c7913ec5b |
| agents/03-web-builder.md | 3720 | e9e1d931c30da552 |
| agents/04-sales-copywriter.md | 4234 | 7d85086f21ac02a3 |
| agents/05-bid-writer.md | 5232 | 78d25be246f3b14c |
| agents/06-risk-reviewer.md | 2711 | 7eff0e4bbb5dae1d |
| agents/07-sales-assistant.md | 3420 | 1813c6cadd7de2b2 |
| agents/08-inspector.md | 3254 | 70957ce40bfb4b66 |
| agents/09-account-analyst.md | 2475 | 99c16c61770ebdb6 |
| bidmason-website.html | 43478 | 3390d74e88a04896 |
| demo-clients/harbor-coast-painting/01-client-build-brief.md | 3226 | 91d19fce49f904e0 |
| demo-clients/harbor-coast-painting/02-market-research-memo.md | 2894 | b0a4390fe8ced16a |
| demo-clients/harbor-coast-painting/03-offer-blueprint.md | 3374 | 1c89c52bc402a448 |
| demo-clients/harbor-coast-painting/04-website-harbor-coast.html | 22049 | bbf15fa08b88542a |
| demo-clients/harbor-coast-painting/05-walkthrough-voice-note.md | 2008 | 54000ae8390b396d |
| demo-clients/harbor-coast-painting/06-proposal-mariners-landing.md | 7122 | 00c33dae1a9eaef8 |
| demo-clients/harbor-coast-painting/07-risk-review.md | 2876 | 70e337bf30eb1dfe |
| demo-clients/harbor-coast-painting/08-follow-up-sequence.md | 4319 | 1ae212ed66a4882f |
| demo-clients/harbor-coast-painting/09-qa-report.md | 2972 | b93e6bdbf3bd7cfc |
| demo-clients/harbor-coast-painting/10-monthly-report-sample.md | 2064 | f206b1c4b6c14e1a |
| demo-clients/harbor-coast-painting/harbor-coast-proposal-unit-turn-program-v2026-06-11.pdf | 10215 | 23d380df90280a10 |
| demo-clients/harbor-coast-painting/make_proposal_pdf.py | 14710 | 4db3c9b8fb101595 |
| operations/90-day-launch-plan.md | 2323 | b381a3499c2c8c43 |
| operations/follow-up-sequences.md | 4165 | 0ff0ef9bca09dfd2 |
| operations/intake-and-client-build-brief.md | 2247 | cbd60426745dc7a6 |
| operations/monthly-report-template.md | 1190 | cd7515737de53071 |
| operations/pricing-and-packages.md | 2818 | 26d0a8362a4e1c5f |
| operations/proposal-master-template.md | 3408 | bf1a6e765dc4413c |
| operations/qa-coordinator-hire.md | 2249 | 51df05ce8520c633 |
| operations/qc-checklists.md | 2034 | d29ddc37abd9cf94 |
| README.md | 6099 | 5cf5b24b7032bd3c |
| sales/pitch-and-outreach.md | 4119 | 4d4ad89bee727564 |

## Import and trust status

- **Imported original text:** 12/32 files, including all 8 operational policies, the sales outreach playbook, and three synthetic Harbor Coast source documents. `ci/source_integrity.py` enforces exact original Git blob hashes for each file; `ci/run` executes it for fast, PR, and security stages.
- **Imported separately from Project attachments:** full `docs/BIDMASON_MASTER_IMPLEMENTATION_PLAN.md` and `docs/BIDMASON_EXECUTION_TRACKER.md`.
- **Not yet committed:** 20 of 32 original ZIP files, including the historical PDF, two illustrative/nonpersistent HTML websites, the nine role prompts, and other synthetic demo material.
- **Not approved for external use:** the historical Harbor Coast website and proposal contain unverified claims and pricing contradictions. Do not serve or publish them until their issue-specific corrections and QA passes are recorded.
- The blueprint's truthful claims, tenant isolation, pricing minimums, approval and send restrictions supersede inconsistent historical sample instructions.
- Do **not** mark `BM-001` or `[PLAN 1/8]` complete merely because inventory is present. Actual source import, build integration and deployed evidence remain outstanding.

### Provenance and publish policy

Original source text is deliberately preserved unchanged, including historical errors and marketing guidance. In particular, the unverified Harbor Coast credentials, below-minimum studio pricing, and scripts that imply a form submission succeeded are **not approved for production use**. The source archive is for provenance and regression testing. The authoritative master blueprint requires truthful AI disclosure when appropriate; the older outreach template's broad instruction to never mention AI does not override this.

GitHub SHA-1 blob identities for the first 12 imported entries were independently compared to their June 2026 ZIP bytes. Actions run [38693225530](https://github.com/mlookhere/Bidmason/actions/runs/38693225530) passed all 3 current jobs at commit `c0116619ddc39fdeebe61e3ac5d1f5d4e01eb07d`. This proves only the source-integrity and CI checks in that commit, not application readiness.
