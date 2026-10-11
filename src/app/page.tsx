import Link from "next/link";
import ThemeSwitch from "./theme-switch";

const stages = [
  { number: "01", title: "Ingest", copy: "Upload contract, purchase order and invoice PDFs in an authorized Judge Preview session." },
  { number: "02", title: "Investigate", copy: "Match document identities, pricing, validity dates and amendments across the source set." },
  { number: "03", title: "Verify", copy: "Challenge candidate findings, validate citations and calculate discrepancies deterministically." },
];

const assurances = [
  ["01", "Exact source citations", "Page-level excerpts keep every finding close to the documents behind it."],
  ["02", "Deterministic arithmetic", "Price differences and quantities are calculated in code, not estimated by a model."],
  ["03", "Amendment-aware review", "Conflicting or newer terms are surfaced for review before a claim is supported."],
  ["04", "Human review before action", "MarginGhost identifies potential discrepancies; people decide what happens next."],
];

export default function Home() {
  return <main className="mg-home" id="overview">
    <div className="mg-shell">
      <header className="mg-nav">
        <Link className="mg-brand" href="/" aria-label="MarginGhost home">
          <span className="mg-mark" aria-hidden="true"><span /></span>
          <span>MarginGhost<small>FINANCIAL INTELLIGENCE</small></span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#overview" aria-current="page">Overview</a>
          <Link href="/investigate">Investigate</Link>
          <Link href="/demo">Synthetic demo</Link>
          <Link href="/evaluation">Evaluation</Link>
        </nav>
        <ThemeSwitch />
        <Link className="mg-nav-cta" href="/judge-preview">Judge Preview <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="mg-hero" aria-labelledby="hero-title">
        <div className="mg-hero-copy">
          <div className="mg-kicker"><span className="mg-status-dot" /> EVIDENCE-FIRST INVOICE INTELLIGENCE <span className="mg-kicker-rule" /></div>
          <h1 id="hero-title">Know what every invoice <em>should cost.</em></h1>
          <p className="mg-lede">An evidence-first AI agent that investigates supplier invoices against contracts and purchase orders — exposing potential overcharges with verifiable source evidence.</p>
          <div className="mg-actions">
            <Link className="mg-button mg-button-primary" href="/demo">Explore the demo <span aria-hidden="true">↗</span></Link>
            <a className="mg-button mg-button-secondary" href="#how-it-works">How it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className="mg-access-note"><span aria-hidden="true">◈</span> Live processing is restricted to authorized Judge Preview sessions.</p>
        </div>

        <div className="mg-showcase" aria-label="Synthetic sample invoice investigation">
          <div className="mg-showcase-top"><span><i /> CASE MG–1048</span><span>INR <b>·</b> SAMPLE</span></div>
          <div className="mg-document-flow" aria-label="Contract, purchase order and invoice compared">
            <article className="mg-doc-card mg-doc-contract"><span className="mg-doc-icon">C</span><span className="mg-doc-type">CONTRACT</span><strong>C-001</strong><small>Agreed unit price</small><b>₹480 <i>/ unit</i></b><span className="mg-doc-foot">CLAUSE 4.1 <span>PAGE 01</span></span></article>
            <span className="mg-flow-link" aria-hidden="true"><i /></span>
            <article className="mg-doc-card mg-doc-po"><span className="mg-doc-icon">P</span><span className="mg-doc-type">PURCHASE ORDER</span><strong>P-001</strong><small>Ordered quantity</small><b>400 <i>units</i></b><span className="mg-doc-foot">MATCHED <span>PAGE 01</span></span></article>
            <span className="mg-flow-link" aria-hidden="true"><i /></span>
            <article className="mg-doc-card mg-doc-invoice"><span className="mg-doc-icon">I</span><span className="mg-doc-type">INVOICE</span><strong>I-001</strong><small>Billed unit price</small><b>₹525 <i>/ unit</i></b><span className="mg-doc-foot">LINE 01 <span>PAGE 01</span></span></article>
          </div>
          <div className="mg-finding">
            <div className="mg-finding-heading"><span><i /> INVESTIGATION FINDING</span><span className="mg-supported">SUPPORTED</span></div>
            <div className="mg-finding-main"><div><small>POTENTIAL OVERCHARGE</small><strong>₹18,000</strong></div><div className="mg-audit-score"><span>SELF-AUDIT</span><b>5<span>/</span>5 <i>checks passed</i></b></div></div>
            <div className="mg-math"><span>₹525 <small>invoice</small></span><b>−</b><span>₹480 <small>contract</small></span><b>×</b><span>400 <small>quantity</small></span><b>=</b><strong>₹18,000</strong></div>
            <div className="mg-evidence"><span className="mg-evidence-check">✓</span><span><b>Evidence reconciled</b><small>Contract C-001 · PO P-001 · Invoice I-001</small></span><a href="/demo" aria-label="Review synthetic sample evidence">↗</a></div>
          </div>
          <div className="mg-sample-stamp"><span>FIXED EXAMPLE</span><b>SYNTHETIC SAMPLE CASE</b></div>
          <span className="mg-orbit mg-orbit-one" /><span className="mg-orbit mg-orbit-two" />
        </div>
        <div className="mg-hero-foot"><span>TRACEABLE BY DESIGN</span><span>01 / 03</span></div>
      </section>

      <section className="mg-method" id="how-it-works" aria-labelledby="method-title">
        <div className="mg-section-head"><div><span className="mg-section-index">A CLEAR REVIEW PATH <i>—</i> 01</span><h2 id="method-title">From source documents<br />to a <em>defensible finding.</em></h2></div><p>Each stage is designed to make a potential discrepancy easier to trace, check and understand.</p></div>
        <div className="mg-stage-grid">{stages.map(stage => <article className="mg-stage" key={stage.number}><div className="mg-stage-top"><span>{stage.number}</span><i aria-hidden="true">↗</i></div><h3>{stage.title}</h3><p>{stage.copy}</p></article>)}</div>
        <p className="mg-permission-note"><span>i</span> PDF uploads and live investigation are available only in an authorized Judge Preview session. The public demo uses fixed synthetic examples.</p>
      </section>

      <section className="mg-trust" id="reliability" aria-labelledby="trust-title">
        <div className="mg-trust-intro"><span className="mg-section-index">BUILT AROUND EVIDENCE <i>—</i> 02</span><h2 id="trust-title">Precision in the numbers.<br /><em>Judgment in the hands of people.</em></h2><p>Potential overcharges are surfaced with their supporting evidence. A qualified person remains responsible for review and action.</p><Link href="/evaluation" className="mg-text-link">Explore reliability <span aria-hidden="true">↗</span></Link></div>
        <div className="mg-assurance-list">{assurances.map(([number, title, copy]) => <article className="mg-assurance" key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div><i aria-hidden="true">↗</i></article>)}</div>
        <div className="mg-evaluation-note"><span className="mg-eval-glyph" aria-hidden="true">9</span><p><b>Nine deterministic adversarial regression scenarios</b><span>Regression coverage checks expected handling across synthetic cases. It is not a measure of model accuracy.</span></p><Link href="/evaluation" aria-label="Review deterministic regression scenarios">↗</Link></div>
      </section>

      <section className="mg-final-cta" aria-labelledby="final-title"><span className="mg-section-index">THE REAL COST, IN CONTEXT</span><h2 id="final-title">Every invoice tells a story.<br /><em>Know the real cost.</em></h2><div className="mg-actions"><Link className="mg-button mg-button-primary" href="/demo">Try synthetic demo <span aria-hidden="true">↗</span></Link><Link className="mg-button mg-button-secondary" href="/evaluation">Explore reliability <span aria-hidden="true">↗</span></Link></div><span className="mg-cta-orbit" aria-hidden="true" /></section>

      <footer className="mg-footer"><Link className="mg-footer-brand" href="/"><span className="mg-mark" aria-hidden="true"><span /></span> MarginGhost</Link><span>Evidence first. Human reviewed.</span><span>© 2026 MARGINGHOST</span></footer>
    </div>
  </main>;
}
