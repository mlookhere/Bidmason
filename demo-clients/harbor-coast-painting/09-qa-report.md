# QA Report — Harbor Coast Painting (website mockup + proposal PDF + email sequence)

Inspector pass · 2026-06-11
**Verdict: FAIL for launch/send — 3 blocking issues. PASS on everything else.**

## Blocking (must fix before launch/send)

1. **Website trust strip + footer carry credential claims (license, insured, RRP, CSLB number) that are client-stated but document-unverified.** Brief Outstanding items 1-2 are still open. Location: trust strip, footer. Fix: hold launch until operator verifies CSLB record and receives COI + RRP certificates, or strip the claims from the mockup shown to the client.
2. **Proposal studio As-Needed rate ($400) conflicts with the $450 minimum job fee in the brief.** Risk Review item #2, unresolved. Fix: Marcus decides (waive minimum for turns, or reprice studio As-Needed to $450) before the PDF is marked final.
3. **Testimonial slot is a placeholder.** Correctly flagged on-page with a do-not-publish banner, but the section must be filled or removed before launch. Fix: chase the commercial reference quote (brief Outstanding #4).

## Non-blocking (fix when convenient)

4. Website gallery section is absent pending unit-turn photos (brief Outstanding #3); add when assets arrive.
5. Email msg 7 contains a computed figure ($250 stairwell add-on) pending Marcus's confirmation; sequence can load with msg 7 held back.
6. Hero card schedule is illustrative; the on-page note covers it, but consider softer wording if a prospect mistakes it for live data.

## Checked and clean

- **Website:** anchor links resolve (nav, footer, in-body); form validates required fields and shows confirmation; phone is click-to-call and consistent in nav and footer (NAP consistent: name, address, phone match everywhere); mobile breakpoints at 900/620px, no horizontal scroll at 375px width; no lorem ipsum or {merge fields}; no other client's name (searched: Bayview, Pacific Shine, prior demo names); CTAs on every section; meta title and description set; no AI-pattern language found (no em dashes, no "Not X. Not Y.", no fragment stacks).
- **Proposal PDF:** prospect name, property, and proposal number correct on all 4 pages; pricing math verified (10% volume discount: 400→360, 500→450, 600→540; monthly estimate 5-6 × $450 = $2,250-$2,700); all 8 sections present; Internal Note confirmed stripped (text search of built PDF); branding block correct; signature table intact on final page; tables not split mid-row.
- **Email sequence:** subjects plain and property-specific; no em dashes, no fake urgency, one question max per email; services and property details match brief and voice note; no duplicated paragraphs across messages.

## Not checked (out of mockup scope)

- Form backend submission (mockup has no backend; wire form service before launch)
- Live mobile device testing (CSS-only verification)
- Print rendering of PDF on physical paper

**Operator: items 1-3 are your approval gates. Everything else is ready.**
