import type {Metadata} from "next";
import {buildSyntheticDeliveryLabCases, buildSyntheticDeliveryLabSummaries,
  type DeliveryLabCase} from "../../lib/delivery-lab-fixtures.ts";

export const metadata: Metadata = {
  title: "Delivery Safety Lab | BidMason Internal Preview",
  description: "Fictional, non-sending delivery review examples. Not a customer portal.",
  robots: {index: false, follow: false},
};
const EVENT_NAMES: Record<string,string> = {
  reserved:"Local reservation (fictional)",
  provider_accepted:"Acceptance reported (fictional)",
  provider_delivered:"Delivery reported (fictional)",
  provider_bounced:"Bounce reported (fictional)",
  provider_complained:"Complaint reported (fictional)",
  recipient_opted_out:"Recipient opt-out (fictional)",
  recipient_replied:"Reply reported (fictional)",
};

/** A prior-proposal hold outranks a local proposal's hypothetical due date.
 * Never show a new reminder date for a recipient requiring stop/consent/reply
 * review. No output from this static preview is permission to contact. */
function safeReminderTime(scenario: DeliveryLabCase): string {
  if (scenario.triage.category !== "waiting-for-cooldown"
    && scenario.triage.category !== "external-authorization-required") {
    return "None — no scheduled send";
  }
  return scenario.followUp.nextEligibleAt ?? "None — no scheduled send";
}

export default function DeliveryLab() {
  const scenarios=buildSyntheticDeliveryLabCases();
  const summaries=buildSyntheticDeliveryLabSummaries();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="notice" role="status">
        Internal development preview. Synthetic records only. No customer data, delivery, or approvals.
      </div>
      <header className="shell site-header">
        <span className="wordmark">BID<span>MASON</span><span className="mark">.</span></span>
        <nav aria-label="Delivery preview navigation"><a href="/">Preview home</a></nav>
      </header>
      <main id="main-content" tabIndex={-1} className="shell delivery-lab">
        <p className="eyebrow">Item 6 · Offline review demonstration</p>
        <h1>Delivery safety lab</h1>
        <p className="lab-lede">
          These eight invented scenarios are calculated from BidMason&apos;s internal
          CRM projection and follow-up assessment. A reported delivery,
          fictional consent status, or eligible timestamp is never proof of a
          real send or authorization to contact a customer.
        </p>
        <p className="lab-warning">
          <strong>Production controls not verified:</strong> Tenant authentication,
          real provider signatures, sender consent, transactional replay protection,
          human approvals, and security review. This page is not access controlled
          and contains no real customer or contractor information.
        </p>
        <section className="lab-summary-section" aria-labelledby="review-summary-heading">
          <h2 id="review-summary-heading">Fictional CRM review overview</h2>
          <p className="lab-lede">Only invented companies and aggregated counts are displayed. Each company is calculated independently; no recipient list, approval or send queue exists.</p>
          <div className="lab-summary-grid">
            {summaries.map(item=>(
              <article className="lab-summary" key={item.company} data-review-company={item.company}>
                <h3>{item.company}</h3>
                <p className="lab-summary-caption">Synthetic review totals · No customer records</p>
                <dl className="lab-summary-counts">
                  <div><dt>Cases reviewed</dt><dd>{item.report.reviewedCases}</dd></div>
                  <div><dt>Stop-contact review</dt><dd>{item.report.attention.stopContact}</dd></div>
                  <div><dt>Operator review</dt><dd>{item.report.attention.operatorReview}</dd></div>
                  <div><dt>Deferred</dt><dd>{item.report.attention.deferred}</dd></div>
                </dl>
                <h4 className="lab-summary-subheading">Fictional pipeline</h4>
                <p className="lab-summary-caption">
                  Case-level delivery reports; proposal-level deal outcomes. No verified provider events.
                </p>
                <dl className="lab-summary-counts">
                  <div><dt>Reported delivered · cases</dt><dd>{item.pipeline.delivery.reportedDelivered}</dd></div>
                  <div><dt>Bounced · cases</dt><dd>{item.pipeline.delivery.bounced}</dd></div>
                  <div><dt>Won · unique proposals</dt><dd>{item.pipeline.deals.won}</dd></div>
                  <div><dt>Lost · unique proposals</dt><dd>{item.pipeline.deals.lost}</dd></div>
                  <div><dt>Unverified · unique proposals</dt><dd>{item.pipeline.deals.unverified}</dd></div>
                  <div><dt>Total unique proposals</dt><dd>{item.pipeline.distinctProposals}</dd></div>
                </dl>
                <p className="lab-summary-caption">
                  Simulation only. Incomplete fictional evidence. No contact authorization or live tenant access.
                </p>
              </article>
            ))}
          </div>
        </section>
        <section aria-labelledby="cases-heading">
          <h2 id="cases-heading">Fictional delivery cases</h2>
          <div className="lab-grid">
            {scenarios.map(scenario => (
              <article className="lab-case" key={scenario.id} data-scenario={scenario.id}>
                <p className="lab-tag">Synthetic scenario · Not a customer record</p>
                <h3>{scenario.label}</h3>
                <p className="lab-company">{scenario.company}</p>
                <dl className="lab-facts">
                  <div><dt>Delivery evidence</dt><dd>{scenario.projection.delivery.replaceAll("_"," ")} (simulated)</dd></div>
                  <div><dt>Deal outcome</dt><dd>{scenario.dealOutcome==="won"?"Won — follow-ups stopped (fictional)":scenario.dealOutcome==="lost"?"Lost — follow-ups stopped (fictional)":"No closed outcome in fixture — unverified"}</dd></div>
                  <div><dt>Contact state</dt><dd>{scenario.contactState==="fictional-confirmed"?"Fixture states confirmed (unverified)":"Unknown — blocks contact"}</dd></div>
                  <div><dt>Follow-up assessment</dt><dd>{scenario.triage.attention==="stop-contact"||scenario.triage.historicalReplyObserved||scenario.followUp.state==="blocked"?"Blocked":"Internal candidate only — not send approval"}</dd></div>
                  <div><dt>Next fictional reminder eligibility</dt><dd>{safeReminderTime(scenario)}</dd></div>
                  <div><dt>Earlier proposal suppression</dt><dd>{scenario.historicalSuppression.length?scenario.historicalSuppression.join(", ").replaceAll("_"," ")+" (fictional)":"None in fixture — not verified clearance"}</dd></div>
                  <div><dt>Earlier proposal reply</dt><dd>{scenario.triage.historicalReplyObserved?"Reply in fictional earlier proposal — manual review required":"None in fixture — not verified absence"}</dd></div>
                  <div><dt>Fictional reply</dt><dd>{scenario.projection.replied?"Recorded in fixture":"None in fixture"}</dd></div>
                  <div><dt>Operator review category</dt><dd>{scenario.triage.category.replaceAll("-"," ")} (simulation only)</dd></div>
                </dl>
                <h4>What an operator would review</h4>
                <p className="lab-review-rationale">{scenario.triage.rationale}</p>
                <h4>Why this cannot send</h4>
                <ul className="lab-blockers">
                  {scenario.followUp.blockers.length
                    ?scenario.followUp.blockers.map(reason=><li key={reason}>{reason}</li>)
                    :scenario.historicalSuppression.length
                      ?<li>Earlier recipient suppression overrides this proposal&apos;s internal timing assessment. Contact remains blocked.</li>
                      :scenario.triage.historicalReplyObserved
                        ?<li>Earlier recipient reply requires manual review before a new follow-up. Contact remains blocked.</li>
                        :<li>No internal timing blocker in fixture. External authorization and real consent remain unverified.</li>}
                </ul>
                <details className="lab-history">
                  <summary>Inspect fictional event history ({scenario.projection.eventCount})</summary>
                  <ol>{scenario.projection.timeline.map(event=>(
                    <li key={event.eventId}>
                      <span>{EVENT_NAMES[event.kind]}</span>
                      <time dateTime={event.observedAt}>{event.observedAt}</time>
                    </li>
                  ))}</ol>
                </details>
              </article>
            ))}
          </div>
        </section>
        <section className="lab-footer" aria-labelledby="lab-boundaries">
          <h2 id="lab-boundaries">Delivery remains disabled</h2>
          <p>This static fixture viewer does not collect input, create leads,
             authenticate users, expose proposals, issue access links, send
             notifications, or write events. Approval and deployment require
             separate live verification.</p>
        </section>
      </main>
      <footer className="footer">
        <div className="shell footer-inner">
          <strong>BidMason</strong>
          <span>Synthetic development preview — not accepting submissions.</span>
        </div>
      </footer>
    </>
  );
}
