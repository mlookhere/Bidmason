# BidMason 90-Day Launch Plan

## Days 1–15: Build the internal machine

Create and test:

- [ ] Intake form (fields in `intake-and-client-build-brief.md`)
- [ ] The nine agent prompts loaded and tested (`agents/`)
- [ ] Client Build Brief flow: raw intake → brief → operator approval
- [ ] Proposal master template + PDF pipeline (HTML-to-PDF, branded)
- [ ] QC checklists printed/loaded (`qc-checklists.md`)
- [ ] Follow-up email master templates (`follow-up-sequences.md`)
- [ ] One example demo brand run end-to-end to shake out the pipeline

**Exit criteria:** a walkthrough voice note becomes a branded proposal PDF + delivery email in under 1 hour of operator time.

## Days 16–30: Build 3 demo accounts

Fake but realistic demos — these are the sales weapons:

1. **Commercial cleaning company** (first niche)
2. **Pressure washing company** (second niche)
3. **Landscaping/maintenance company** (third niche)

Each demo includes: website mockup, proposal PDF, follow-up email set, pricing table.

**Exit criteria:** you can show a prospect "here's what your business looks like after BidMason" in 5 minutes.

## Days 31–60: Sell manually

Contact **300 businesses** (10/day) in the starting niches. Lead with the free sample:

> "I'll turn one of your past quotes into a professional commercial proposal for free."

Channels: cold email, cold call, LinkedIn, local contractor groups, supplier counters (`sales/pitch-and-outreach.md`).

**Targets:**
- 10 free samples delivered
- 3 paid clients
- $3k–$7k setup revenue
- $500–$1,000 MRR

## Days 61–90: Productize

Build (Supabase + v0/Vercel):

- [ ] Client dashboard (BidMason CRM: leads, proposals, pipeline, follow-ups due)
- [ ] Proposal generator (walkthrough note in → draft out, operator QC gate)
- [ ] PDF storage per client
- [ ] Stripe billing (setup + subscription)
- [ ] Client template library
- [ ] Admin QC panel (queue + checklists + approve/publish gate)

**Targets:**
- 10 paying clients
- $10k–$25k setup collected
- $1.5k–$3k MRR

## The operator's role throughout

Pick the niche · sell the offer · approve outputs · improve prompts · build repeatable templates · keep clients happy · make sure nothing dumb goes out. First hire (QA Coordinator, `qa-coordinator-hire.md`) comes when QC time exceeds ~15 hrs/week.
