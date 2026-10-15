const capabilities = [
  {
    number: "01",
    title: "Commercial websites",
    description: "A professional presence designed around the services your commercial buyers need.",
  },
  {
    number: "02",
    title: "Proposal workflows",
    description: "Structured scope, pricing options, and approval before anything is sent.",
  },
  {
    number: "03",
    title: "Follow-up support",
    description: "Practical reminders, next steps, and pipeline visibility for every opportunity.",
  },
] as const;

export default function Home() {
  return (
    <main>
      <div className="notice" role="status">
        Internal development preview. No live lead capture, proposals, or customer sending is enabled.
      </div>
      <header className="shell site-header">
        <a className="wordmark" href="#home" aria-label="BidMason home">BID<span>MASON</span><span className="mark">.</span></a>
        <nav aria-label="Main navigation"><a href="#approach">Approach</a><a href="#capabilities">What we&apos;re building</a></nav>
      </header>
      <section className="hero shell" id="home">
        <div className="eyebrow">A clearer path to commercial work</div>
        <h1>Present the work.<br/><em>Win the bid.</em></h1>
        <p className="lede">BidMason is building a practical sales toolkit for commercial service contractors: professional websites, better proposals, and follow-up systems.</p>
        <a className="primary-link" href="#capabilities">Explore the concept <span aria-hidden="true">↗</span></a>
        <p className="disclaimer">Concept preview only. Packages, pricing, and availability are not yet offered through this site.</p>
      </section>
      <section className="approach" id="approach">
        <div className="shell approach-grid">
          <div><p className="eyebrow">Built for the way contractors work</p><h2>Less paperwork.<br/>More clarity.</h2></div>
          <p>Capture the details of a walkthrough, shape a clear scope of work, calculate consistent pricing, and review a proposal before sending it to a commercial buyer. Our priorities are accuracy and accountable approvals.</p>
        </div>
      </section>
      <section className="shell capabilities" id="capabilities">
        <p className="eyebrow">Product roadmap</p>
        <h2>One connected workflow.</h2>
        <div className="cards">{capabilities.map((item) => <article className="feature" key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
      </section>
      <footer className="footer"><div className="shell footer-inner"><strong>BidMason</strong><span>Internal preview — not accepting submissions.</span></div></footer>
    </main>
  );
}
