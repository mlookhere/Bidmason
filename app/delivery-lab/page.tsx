import type {Metadata} from "next";
import {buildSyntheticDeliveryLabCases} from "../../lib/delivery-lab-fixtures.ts";

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

export default function DeliveryLab() {
  const scenarios=buildSyntheticDeliveryLabCases();
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
          These four invented scenarios are calculated from BidMason&apos;s internal
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
                  <div><dt>Contact state</dt><dd>{scenario.contactState==="fictional-confirmed"?"Fixture states confirmed (unverified)":"Unknown — blocks contact"}</dd></div>
                  <div><dt>Follow-up assessment</dt><dd>{scenario.followUp.state==="blocked"?"Blocked":"Internal candidate only — not send approval"}</dd></div>
                  <div><dt>Fictional reply</dt><dd>{scenario.projection.replied?"Recorded in fixture":"None in fixture"}</dd></div>
                  <div><dt>Operator review category</dt><dd>{scenario.triage.category.replaceAll("-"," ")} (simulation only)</dd></div>
                </dl>
                <h4>What an operator would review</h4>
                <p className="lab-review-rationale">{scenario.triage.rationale}</p>
                <h4>Why this cannot send</h4>
                <ul className="lab-blockers">
                  {scenario.followUp.blockers.length
                    ?scenario.followUp.blockers.map(reason=><li key={reason}>{reason}</li>)
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
