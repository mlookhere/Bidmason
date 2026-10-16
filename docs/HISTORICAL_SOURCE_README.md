# BidMason — Company Operating System

**Public brand:** BidMason — Commercial websites, proposals, and follow-up systems for contractors who want bigger jobs.

**Internal reality:** an AI-run production company. AI researches, builds, writes, drafts, designs, follows up, audits, and reports. The operator (you) approves the final output. Customer-facing, the word "AI" never appears.

## The two unbreakable rules

1. **AI creates. AI cannot publish without approval.** Everything is a draft until the operator approves it. The operator approves websites before launch; the contractor approves proposals before sending; no legal-contract language goes out without disclaimers or lawyer-reviewed templates.
2. **Never say AI in client-facing output.** No AI, automation buzzwords, SaaS jargon, machine learning, agents, tokens, or prompts in anything a contractor or their customer sees. Public language: "We build commercial sales systems for contractors."

## Product modules

| Module | What it is |
|---|---|
| **BidMason Sites** | Commercial-grade contractor websites: service pages, industry pages, service-area pages, galleries, quote + proposal request forms |
| **BidMason Proposals** | Walkthrough note → polished proposal: scope, three-tier pricing, exclusions, timeline, signature-ready acceptance, branded PDF |
| **BidMason Follow-Up** | The 7-message sequence engine: walkthrough thanks → delivery → reminders → lost-deal recycle → onboarding → renewal/upsell |
| **BidMason CRM** | CRM-lite: lead tracking, proposals sent/won, pipeline value, follow-ups due |
| **BidMason Commercial Kit** | Property-manager outreach emails, cold call scripts, LinkedIn messages, flyers, leave-behind one-pagers |
| **BidMason Client Portal** | Client views proposal, accepts an option, requests changes, downloads PDF |

## The killer feature

> Record a 2-minute walkthrough note and get back a polished commercial proposal, pricing options, exclusions, timeline, a follow-up email, and an internal note listing what to confirm before final quote.

When walkthrough notes arrive: **Bid Writer → Risk Reviewer → Sales Assistant**, in one pass.

## The production line (every client, six steps)

| Step | What happens | Departments | Operator approves |
|------|--------------|-------------|-------------------|
| 1. Intake | Client info → Client Build Brief | Market Analyst (light) | The brief |
| 2. Positioning | Niche angle, packages, page map, proposal plan | Market Analyst → Offer Architect | The offer |
| 3. Website build | Pages, copy, forms | Web Builder + Sales Copywriter → Inspector | Site before launch |
| 4. Proposal system | Templates per top service | Bid Writer → Risk Reviewer | Legal/risk language |
| 5. Follow-up automation | 7-email sequence | Sales Assistant | Tone, once |
| 6. Monthly report | Leads, proposals, wins, improvements | Account Analyst | Sent monthly |

## The nine departments

| # | Department | Agent | File | Produces |
|---|-----------|-------|------|----------|
| 1 | Research | Market Analyst | `agents/01-market-analyst.md` | Market Research Memo |
| 2 | Strategy | Offer Architect | `agents/02-offer-architect.md` | Offer Blueprint |
| 3 | Website | Web Builder | `agents/03-web-builder.md` | Site structure and pages |
| 4 | Copy | Sales Copywriter | `agents/04-sales-copywriter.md` | Page copy, FAQs |
| 5 | Proposal | Bid Writer | `agents/05-bid-writer.md` | Proposals, templates, pricing tiers |
| 6 | Legal Guardrail | Risk Reviewer | `agents/06-risk-reviewer.md` | Risk Flag Report |
| 7 | Follow-up | Sales Assistant | `agents/07-sales-assistant.md` | Email sequences |
| 8 | QA | Inspector | `agents/08-inspector.md` | QA Report |
| 9 | Reporting | Account Analyst | `agents/09-account-analyst.md` | Monthly Client Report |

Each agent file is a complete, standalone system prompt. Paste it into a Claude/GPT project, a subagent definition, or an n8n LLM node and it runs that department.

## Operations references

- `operations/intake-and-client-build-brief.md` — intake form + brief template. Every client starts here.
- `operations/pricing-and-packages.md` — BidMason's own pricing (Starter/Growth/Commercial Pro) + contractor tier construction rules.
- `operations/qc-checklists.md` — close QC vs light QC vs automated; the approval rule.
- `operations/follow-up-sequences.md` — the 7-message master templates.
- `operations/proposal-master-template.md` — the merge-field proposal skeleton.
- `operations/monthly-report-template.md` — the report skeleton.
- `operations/qa-coordinator-hire.md` — first-hire job spec, checklist, pay rates.
- `operations/90-day-launch-plan.md` — days 1–90, targets included.
- `sales/pitch-and-outreach.md` — the pitch, cold email/call/LinkedIn scripts, free-sample offer.

## Tech stack (internal — never customer-facing)

- **v0/Vercel** — site and app generation/deployment
- **Supabase** — auth, database, file storage, edge functions (Stripe webhooks)
- **Claude / OpenAI APIs** — drafting, transcription, QC, proposal generation, summarization
- **n8n** — internal workflow automation (intake → brief → build chain)
- **Stripe** — recurring billing
- **Resend/Postmark** — email delivery
- **HTML-to-PDF / React PDF** — branded proposal generation
- **Google Drive/Dropbox** — client asset intake early on

## Niche focus

Start narrow: **commercial cleaning** first, **pressure washing** second, **landscaping/maintenance** third. The shared thread: recurring commercial contracts sold to property managers, HOAs, restaurants, gyms, medical offices, and storefronts. Don't dilute to "all contractors."

## Two-layer strategy

- **Layer 1 — service business (now):** "We build your contractor sales system for you." Setup cash + recurring revenue.
- **Layer 2 — software platform (later):** "Use BidMason to generate your own proposals, pricing tiers, and follow-ups." The service business funds the SaaS; the SaaS makes the service scalable.

**Do not sell AI. Sell bigger contracts. Use AI as the invisible workforce.**
